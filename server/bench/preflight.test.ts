import { describe, expect, test } from "bun:test";
import type { TestResult } from "../sample";
import { parseBench } from "./config";
import type { BenchEntrant } from "./entrants";
import { type Check, estimate, formatChecks, formatEstimate, paceFor, preflight } from "./preflight";

const mock: BenchEntrant = { id: "heuristic", label: "Heuristic", kind: "baseline", live: false };
const live: BenchEntrant = { id: "live-x", label: "Live X", kind: "llm", live: true };
const down: BenchEntrant = { id: "live-y", label: "Live Y", kind: "llm", live: true, unavailable: "set Y in .env" };

function result(over: Partial<TestResult> = {}): TestResult {
  return { status: "ok", choice: "a", latencyMs: 300, options: 4, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.001 }, ...over };
}

const cfg = parseBench({
  name: "demo",
  seeds: 3,
  variants: ["described"],
  tetris: { maxDurationMs: 60000, maxPieces: 1000 },
  models: ["live-x"],
});

describe("paceFor", () => {
  test("fast when every entrant is a mock", () => {
    expect(paceFor([mock])).toBe("fast");
  });

  test("wall when one entrant is live", () => {
    expect(paceFor([mock, live])).toBe("wall");
  });
});

describe("preflight", () => {
  test("an unavailable entrant fails without a call, and the live one is still checked", async () => {
    const calls: string[] = [];
    const checks = await preflight([down, live], async (e) => {
      calls.push(e.id);
      return result();
    });
    expect(calls).toEqual(["live-x"]);
    expect(checks[0]).toMatchObject({ id: "live-y", ok: false, detail: "set Y in .env" });
    expect(checks[1]).toMatchObject({ id: "live-x", ok: true, latencyMs: 300, costUsd: 0.001 });
    expect(checks[1].detail).toBe("chose a from 4 options");
  });

  test("a mock entrant passes without a call", async () => {
    const calls: string[] = [];
    const [check] = await preflight([mock], async (e) => {
      calls.push(e.id);
      return result();
    });
    expect(calls).toEqual([]);
    expect(check).toMatchObject({ id: "heuristic", ok: true, detail: "mock, no API calls" });
  });

  test("a test that throws becomes a failed check with the message", async () => {
    const [check] = await preflight([live], async () => {
      throw new Error("401 unauthorized");
    });
    expect(check).toMatchObject({ id: "live-x", ok: false, detail: "401 unauthorized" });
  });

  test("a live answer that is not ok fails with its detail", async () => {
    const [check] = await preflight([live], async () => result({ status: "invalid", detail: "not an option" }));
    expect(check).toMatchObject({ ok: false, detail: "not an option" });
  });
});

describe("estimate", () => {
  test("matches are variants x clocks x seeds", () => {
    const e = estimate(cfg, [mock], []);
    expect(e.matches).toBe(6);
    expect(e.pace).toBe("fast");
    expect(e.maxMinutes).toBe(0);
    expect(e.maxCostUsd).toBe(0);
  });

  test("a live check bounds turns, minutes and cost", () => {
    const checks: Check[] = [{ id: "live-x", label: "Live X", ok: true, detail: "", latencyMs: 300, costUsd: 0.001 }];
    const e = estimate(cfg, [live], checks);
    expect(e.pace).toBe("wall");
    expect(e.matches).toBe(6);
    // 3 realtime matches at 1 min, 3 frozen matches of 100 pieces at (300 + 1000) ms each.
    expect(e.maxMinutes).toBeCloseTo(9.5, 6);
    // 3 frozen matches x 100 turns + 3 realtime matches x 120 turns, at $0.001 a turn.
    expect(e.maxCostUsd).toBeCloseTo(0.66, 6);
  });

  test("a frozen match is bounded by frozenPieces times the slowest live answer plus 1 s", () => {
    const frozenOnly = parseBench({ name: "demo", seeds: 1, clocks: ["frozen"], tetris: { frozenPieces: 30 }, models: ["live-x"] });
    const checks: Check[] = [{ id: "live-x", label: "Live X", ok: true, detail: "", latencyMs: 2000, costUsd: 0.001 }];
    const e = estimate(frozenOnly, [live], checks);
    expect(e.matches).toBe(1);
    expect(e.maxMinutes).toBeCloseTo(1.5, 6);
    expect(e.maxCostUsd).toBeCloseTo(0.03, 6);
  });

  test("failed checks are left out of the cost", () => {
    const checks: Check[] = [{ id: "live-x", label: "Live X", ok: false, detail: "", latencyMs: 300, costUsd: 0.001 }];
    expect(estimate(cfg, [live], checks).maxCostUsd).toBe(0);
  });
});

describe("formatChecks", () => {
  test("one line per check with a mark, label, latency and detail", () => {
    const text = formatChecks([
      { id: "a", label: "Heuristic", ok: true, detail: "mock, no API calls" },
      { id: "b", label: "Live X", ok: false, detail: "set X in .env", latencyMs: 312 },
    ]);
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("✓ Heuristic")).toBe(true);
    expect(lines[0]).toContain("mock, no API calls");
    expect(lines[1].startsWith("✗ Live X")).toBe(true);
    expect(lines[1]).toContain("312 ms");
  });
});

describe("formatEstimate", () => {
  test("says the wall-clock numbers are upper bounds", () => {
    const text = formatEstimate({ matches: 6, pace: "wall", maxMinutes: 6, maxCostUsd: 0.72 });
    expect(text).toContain("at most");
    expect(text).toBe("6 matches, wall-clock pace: at most 6 min and $0.72");
  });

  test("fast pace needs no waiting and costs nothing", () => {
    const text = formatEstimate({ matches: 6, pace: "fast", maxMinutes: 0, maxCostUsd: 0 });
    expect(text).toContain("needs no waiting");
    expect(text).toContain("costs nothing");
  });
});
