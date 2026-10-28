import { afterAll, describe, expect, test } from "bun:test";
import { HealthChecks } from "./health";
import type { ModelConfig } from "./types";

// A local server whose /health answers with whatever status the test sets, counting pings.
let status = 200;
let pings = 0;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    if (new URL(req.url).pathname !== "/health") return new Response("no", { status: 404 });
    pings++;
    return new Response("ok", { status });
  },
});
afterAll(() => server.stop(true));

const up: ModelConfig = {
  id: "up",
  label: "Up",
  adapter: "decision",
  model: "m",
  baseUrl: `http://localhost:${server.port}`,
  healthCheck: "/health",
};
// Nothing listens on port 1, so the connection is refused at once.
const down: ModelConfig = { id: "down", label: "Down", adapter: "decision", model: "m", baseUrl: "http://127.0.0.1:1", healthCheck: "/health" };
const unchecked: ModelConfig = { id: "hosted", label: "Hosted", adapter: "decision", model: "m", baseUrl: "http://127.0.0.1:1" };
const info = (id: string) => ({ id, available: true, reason: undefined as string | undefined });

describe("HealthChecks", () => {
  test("a server that answers stays available", async () => {
    status = 200;
    const h = new HealthChecks();
    await h.refresh([up]);
    expect(h.apply(info("up"))).toEqual(info("up"));
    expect(h.problem("up")).toBeUndefined();
  });

  test("a server that doesn't answer becomes unavailable, with the host in the reason", async () => {
    const h = new HealthChecks();
    await h.refresh([down]);
    const result = h.apply(info("down"));
    expect(result.available).toBe(false);
    expect(result.reason).toContain("Not responding at 127.0.0.1:1");
    expect(h.problem("down")).toBe(result.reason);
  });

  test("an error status counts as down", async () => {
    status = 503;
    const h = new HealthChecks();
    await h.refresh([up]);
    expect(h.apply(info("up")).reason).toContain("answered 503");
    status = 200;
  });

  test("models without a health check are never pinged or changed", async () => {
    const h = new HealthChecks();
    await h.refresh([unchecked]);
    expect(h.apply(info("hosted"))).toEqual(info("hosted"));
  });

  test("a model that is already unavailable keeps its own reason", async () => {
    const h = new HealthChecks();
    await h.refresh([down]);
    const off = { id: "down", available: false, reason: "Set LAYA_BASE_URL in .env" };
    expect(h.apply(off)).toEqual(off);
  });

  test("results are reused until they are stale", async () => {
    let now = 0;
    const h = new HealthChecks({ ttlMs: 10_000, now: () => now });
    pings = 0;
    await h.refresh([up]);
    await h.refresh([up]);
    expect(pings).toBe(1);
    now = 10_001;
    await h.refresh([up]);
    expect(pings).toBe(2);
  });

  test("an address that isn't a URL counts as down instead of throwing", async () => {
    const h = new HealthChecks();
    await h.refresh([{ ...down, id: "typo", baseUrl: "192.168.1.5:8000" }]);
    expect(h.problem("typo")).toContain("Not responding");
  });

  test("a model that loses its health check drops its old result", async () => {
    const h = new HealthChecks();
    await h.refresh([down]);
    expect(h.problem("down")).toBeDefined();
    await h.refresh([{ ...down, healthCheck: undefined }]);
    expect(h.problem("down")).toBeUndefined();
  });

  test("a result for an old address doesn't count after the address changes", async () => {
    status = 200;
    const h = new HealthChecks();
    await h.refresh([{ ...down, id: "moved" }]);
    expect(h.problem("moved")).toBeDefined();
    await h.refresh([{ ...up, id: "moved" }]);
    expect(h.problem("moved")).toBeUndefined();
  });

  test("refreshes at the same time share one ping", async () => {
    status = 200;
    const h = new HealthChecks();
    pings = 0;
    await Promise.all([h.refresh([up]), h.refresh([up]), h.refresh([up])]);
    expect(pings).toBe(1);
  });

  test("a slow server times out", async () => {
    const slow = Bun.serve({ port: 0, fetch: () => Bun.sleep(500).then(() => new Response("ok")) });
    try {
      const h = new HealthChecks({ timeoutMs: 50 });
      await h.refresh([{ ...up, id: "slow", baseUrl: `http://localhost:${slow.port}` }]);
      expect(h.problem("slow")).toContain("Not responding");
    } finally {
      slow.stop(true);
    }
  });
});
