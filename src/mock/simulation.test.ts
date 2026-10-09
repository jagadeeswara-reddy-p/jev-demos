import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type ArenaEvent, type ClockMode, type RunConfig } from "../arena/types";
import { MOCK_PROFILES } from "./profiles";
import { ArenaSimulation } from "./simulation";

function config(sources: string[], mode: ClockMode = "realtime", seed = 1): RunConfig {
  return {
    ...DEFAULT_CONFIG,
    seed,
    maxPieces: 300,
    mode,
    agents: sources.map((s, i) => ({ id: `a${i}`, name: s, kind: "llm", sourceId: s })),
  };
}

function runToEnd(cfg: RunConfig): ArenaEvent[] {
  const sim = new ArenaSimulation(cfg);
  const events = sim.start();
  while (!sim.finished) events.push(...sim.step(1000));
  return events;
}

function summary(events: ArenaEvent[], agentId: string) {
  const out = events.find((e) => e.t === "topout" && e.agentId === agentId);
  const lines = events
    .filter((e) => e.t === "lock" && e.agentId === agentId)
    .reduce((n, e) => n + (e.t === "lock" ? e.rows.length : 0), 0);
  const late = events.filter((e) => e.t === "decision" && e.agentId === agentId && e.status === "late").length;
  return { outAt: out?.at ?? Infinity, level: out && out.t === "topout" ? out.level : null, lines, late };
}

describe("ArenaSimulation", () => {
  it("is deterministic for a seed", () => {
    const a = runToEnd(config(["jev", "llm-fast"]));
    const b = runToEnd(config(["jev", "llm-fast"]));
    expect(a.length).toBe(b.length);
    expect(JSON.stringify(a.slice(-50))).toBe(JSON.stringify(b.slice(-50)));
  });

  it("gives every board the same pieces", () => {
    const events = runToEnd(config(["jev", "random"]));
    const spawns = (id: string) =>
      events.filter((e) => e.t === "spawn" && e.agentId === id).map((e) => (e.t === "spawn" ? e.type : ""));
    const a = spawns("a0");
    const b = spawns("a1");
    const n = Math.min(a.length, b.length);
    expect(a.slice(0, n)).toEqual(b.slice(0, n));
  });

  it("ranks survival by decision speed in real time, like the demo", () => {
    const events = runToEnd(config(["jev", "llm-fast", "llm-frontier"]));
    const [jev, fast, frontier] = ["a0", "a1", "a2"].map((id) => summary(events, id));
    expect(jev.outAt).toBeGreaterThan(fast.outAt);
    expect(fast.outAt).toBeGreaterThan(frontier.outAt);
    expect(frontier.late).toBeGreaterThan(0);
  });

  it("removes the speed penalty when the clock is frozen", () => {
    const events = runToEnd(config(["llm-frontier"], "frozen"));
    expect(events.some((e) => e.t === "decision" && e.status === "late")).toBe(false);
    expect(summary(events, "a0").lines).toBeGreaterThan(10);
  });

  it("runs every mock profile without throwing", () => {
    for (const p of MOCK_PROFILES) {
      for (const mode of ["realtime", "frozen"] as const) {
        const events = runToEnd(config([p.id], mode, 5));
        expect(events.at(-1)?.t).toBe("run_finished");
      }
    }
  });

  // CALIBRATE=1 pnpm test prints how each mock profile fares, to tune profiles against the demo.
  it.skipIf(!process.env.CALIBRATE)("prints a calibration table", () => {
    const rows = [1, 2, 3].map((seed) => {
      const events = runToEnd(config(["jev", "llm-fast", "llm-frontier", "heuristic", "random", "no-input"], "realtime", seed));
      return ["jev", "llm-fast", "llm-frontier", "heuristic", "random", "no-input"].map((name, i) => {
        const s = summary(events, `a${i}`);
        return `${name}: out ${(s.outAt / 1000).toFixed(0)}s L${s.level} lines ${s.lines} late ${s.late}`;
      });
    });
    console.log(rows.map((r) => r.join("\n")).join("\n---\n"));
  });
});
