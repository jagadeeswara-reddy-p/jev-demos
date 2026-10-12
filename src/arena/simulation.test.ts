import { describe, expect, it } from "bun:test";
import { MOCK_PROFILES } from "../mock/profiles";
import { mockSourceFor } from "../mock/mockSource";
import { ArenaSimulation } from "./simulation";
import { DEFAULT_CONFIG, type ArenaEvent, type ClockMode, type DecisionSource, type RunConfig } from "./types";

function config(sources: string[], mode: ClockMode = "realtime", seed = 1): RunConfig {
  return {
    ...DEFAULT_CONFIG,
    seed,
    maxPieces: 300,
    mode,
    agents: sources.map((s, i) => ({ id: `a${i}`, name: s, kind: "llm", sourceId: s })),
  };
}

function runToEnd(cfg: RunConfig, sources?: DecisionSource[]): ArenaEvent[] {
  const sim = new ArenaSimulation(cfg, sources ?? cfg.agents.map((a) => mockSourceFor(cfg, a)));
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

  it("rejects an answer that names an option that doesn't exist", () => {
    const cfg = { ...config(["jev"]), maxPieces: 3 };
    const bogus: DecisionSource = { request: (req, deliver) => deliver({ status: "ok", choice: "option_999" }, req.requestedAt + 10) };
    const events = runToEnd(cfg, [bogus]);
    const decisions = events.filter((e) => e.t === "decision");
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((e) => e.t === "decision" && e.status === "invalid")).toBe(true);
  });

  it("accepts answers delivered later, the way a live API call does", () => {
    const cfg = { ...config(["jev"]), maxPieces: 5 };
    const queue: (() => void)[] = [];
    const live: DecisionSource = {
      request: (req, deliver, ctx) => {
        queue.push(() => deliver({ status: "ok", choice: req.candidates[0].id }, ctx.now(), 42));
      },
    };
    const sim = new ArenaSimulation(cfg, [live]);
    const events = sim.start();
    while (!sim.finished) {
      queue.splice(0).forEach((f) => f());
      events.push(...sim.step(20));
    }
    const ok = events.filter((e) => e.t === "decision" && e.status === "ok");
    expect(ok.length).toBe(5);
    expect(ok.every((e) => e.t === "decision" && e.latencyMs === 42)).toBe(true);
  });

  it("grades every answer that names an option, late ones included", () => {
    const events = runToEnd(config(["heuristic", "llm-frontier"]));
    const graded = (id: string, status?: string) =>
      events.filter((e) => e.t === "decision" && e.agentId === id && (!status || e.status === status) && e.bestRank !== undefined);
    // The heuristic bot plays the reference heuristic, so it always picks a rank-1 option.
    expect(graded("a0").length).toBeGreaterThan(0);
    expect(graded("a0").every((e) => e.t === "decision" && e.bestRank === 1)).toBe(true);
    expect(graded("a1", "late").length).toBeGreaterThan(0);
  });

  it("leaves bad answers ungraded", () => {
    const cfg = { ...config(["jev"]), maxPieces: 3 };
    const bogus: DecisionSource = { request: (req, deliver) => deliver({ status: "ok", choice: "option_999" }, req.requestedAt + 10) };
    const events = runToEnd(cfg, [bogus]);
    expect(events.some((e) => e.t === "decision" && e.bestRank !== undefined)).toBe(false);
  });

  it("stops a board at the line target in sprint mode", () => {
    const cfg = { ...config(["heuristic", "jev"], "frozen"), targetLines: 10 };
    const events = runToEnd(cfg);
    const goals = events.filter((e) => e.t === "goal");
    expect(goals.length).toBeGreaterThan(0);
    for (const g of goals) {
      if (g.t !== "goal") continue;
      expect(g.lines).toBeGreaterThanOrEqual(10);
      expect(events.filter((e) => e.t === "lock" && e.agentId === g.agentId).length).toBe(g.pieces);
      // Nothing more happens on a finished board.
      expect(events.some((e) => "agentId" in e && e.agentId === g.agentId && e.at > g.at)).toBe(false);
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
