import { describe, expect, test } from "bun:test";
import { allowedHosts, protect, rejectForeign } from "./guard";

const local = allowedHosts("127.0.0.1", []);
const req = (method: string, headers: Record<string, string>) => new Request("http://x/api/runs", { method, headers });

describe("rejectForeign", () => {
  test("lets this machine's page read and write", () => {
    expect(rejectForeign(req("GET", { host: "localhost:5317" }), local)).toBeUndefined();
    expect(rejectForeign(req("GET", { host: "[::1]:5317" }), local)).toBeUndefined();
    const write = req("POST", { host: "localhost:5317", origin: "http://localhost:5317", "content-type": "application/json" });
    expect(rejectForeign(write, local)).toBeUndefined();
  });

  test("refuses another Host, which is what DNS rebinding looks like", () => {
    expect(rejectForeign(req("GET", { host: "evil.example:5317" }), local)?.status).toBe(403);
  });

  test("refuses a write from another site's page", () => {
    const res = rejectForeign(req("POST", { host: "localhost:5317", origin: "https://evil.example", "content-type": "application/json" }), local);
    expect(res?.status).toBe(403);
  });

  test("refuses a write without a JSON content type (a cross-site form or simple fetch)", () => {
    expect(rejectForeign(req("POST", { host: "localhost:5317", "content-type": "text/plain" }), local)?.status).toBe(415);
    expect(rejectForeign(req("POST", { host: "localhost:5317" }), local)?.status).toBe(415);
  });

  test("ALLOWED_HOSTS adds names; HOST=0.0.0.0 without it answers to any host but still checks writes", () => {
    expect(rejectForeign(req("GET", { host: "arena.lan:5317" }), allowedHosts("0.0.0.0", ["arena.lan"]))).toBeUndefined();
    const open = allowedHosts("0.0.0.0", []);
    expect(open).toBeNull();
    expect(rejectForeign(req("GET", { host: "192.168.1.9:5317" }), open)).toBeUndefined();
    expect(rejectForeign(req("POST", { host: "192.168.1.9:5317" }), open)?.status).toBe(415);
  });
});

describe("protect", () => {
  test("wraps /api/ routes, function and per-method, and leaves the page alone", async () => {
    const page = { html: true };
    const routes = protect(
      {
        "/": page,
        "/api/health": () => new Response("ok"),
        "/api/runs": { POST: () => new Response("started") },
      },
      local,
    );
    expect(routes["/"]).toBe(page);
    const foreign = req("GET", { host: "evil.example" });
    expect(((await (routes["/api/health"] as (r: Request) => Response)(foreign)) as Response).status).toBe(403);
    const ok = req("POST", { host: "localhost", "content-type": "application/json" });
    expect(await ((await (routes["/api/runs"].POST as (r: Request) => Response)(ok)) as Response).text()).toBe("started");
  });
});
