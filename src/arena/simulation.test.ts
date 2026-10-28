import { describe, expect, it } from "bun:test";
import { mockSourceFor } from "../mock/mockSource";
import { MOCK_PROFILES } from "../mock/profiles";
import { ArenaSimulation } from "./simulation";
import { type ArenaEvent, type ClockMode, DEFAULT_CONFIG, type RunConfig, type TetrisAgent } from "./types";

function config(sources: string[], mode: ClockMode = "realtime", seed = 1): RunConfig {
  return {
    ...DEFAULT_CONFIG,
    seed,
    maxPieces: 300,
    mode,
    agents: sources.map((s, i) => ({ id: `a${i}`, name: s, kind: "llm", sourceId: s })),
  };
}

function runToEnd(cfg: RunConfig, agents?: TetrisAgent[]): ArenaEvent[] {
  const sim = new ArenaSimulation(cfg, agents ?? cfg.agents.map((a) => mockSourceFor(cfg, a)));
  const events = sim.start();
  while (!sim.finished) events.push(...sim.step(1000));
  return events;
}

function summary(events: ArenaEvent[], agentId: string) {
  const out = events.find((e) => e.t === "topout" && e.agentId === agentId);
  const lines = events.filter((e) => e.t === "lock" && e.agentId === agentId).reduce((n, e) => n + (e.t === "lock" ? e.rows.length : 0), 0);
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
    const spawns = (id: string) => events.filter((e) => e.t === "spawn" && e.agentId === id).map((e) => (e.t === "spawn" ? e.type : ""));
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

  it("frozen clock: an answer that arrives after the time-out is late, even while the piece is still falling", () => {
    // Like a live model whose reply comes back just after the 1 s limit, while the released piece is falling.
    let reply: ((at: number) => void) | null = null;
    const slow: TetrisAgent = {
      request(turn, deliver) {
        if (turn.detail.pieceId === 1) reply = (at) => deliver({ status: "ok", choice: turn.detail.candidates[0].id }, at, at - turn.requestedAt);
      },
    };
    const cfg = { ...config(["slow"], "frozen"), frozenTimeoutMs: 1000, maxPieces: 3 };
    const sim = new ArenaSimulation(cfg, [slow]);
    const events = sim.start();
    while (sim.t < 1010) events.push(...sim.step(10));
    reply!(sim.t);
    for (let i = 0; i < 20; i++) events.push(...sim.step(10));
    const first = events.filter((e) => e.t === "decision" && e.pieceId === 1).map((e) => (e.t === "decision" ? e.status : ""));
    expect(first).toEqual(["timeout", "late"]);
    expect(events.some((e) => e.t === "lock" && e.pieceId === 1 && e.byDecision)).toBe(false);
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
    const bogus: TetrisAgent = { request: (turn, deliver) => deliver({ status: "ok", choice: "option_999" }, turn.requestedAt + 10) };
    const events = runToEnd(cfg, [bogus]);
    const decisions = events.filter((e) => e.t === "decision");
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((e) => e.t === "decision" && e.status === "invalid")).toBe(true);
  });

  it("accepts answers delivered later, the way a live API call does", () => {
    const cfg = { ...config(["jev"]), maxPieces: 5 };
    const queue: (() => void)[] = [];
    const live: TetrisAgent = {
      request: (turn, deliver, ctx) => {
        queue.push(() => deliver({ status: "ok", choice: turn.detail.candidates[0].id }, ctx.now(), 42));
      },
    };
    const sim = new ArenaSimulation(cfg, [live]);
    const events = sim.start();
    while (!sim.finished) {
      for (const f of queue.splice(0)) f();
      events.push(...sim.step(20));
    }
    const ok = events.filter((e) => e.t === "decision" && e.status === "ok");
    expect(ok.length).toBe(5);
    expect(ok.every((e) => e.t === "decision" && e.latencyMs === 42)).toBe(true);
  });

  it("ignores answers that arrive after the run was stopped", () => {
    const cfg = { ...config(["jev"]), maxPieces: 5 };
    const queue: (() => void)[] = [];
    const live: TetrisAgent = {
      request: (turn, deliver, ctx) => {
        queue.push(() => deliver({ status: "ok", choice: turn.detail.candidates[0].id }, ctx.now(), 42));
      },
    };
    const sim = new ArenaSimulation(cfg, [live]);
    const events = sim.start();
    events.push(...sim.stop());
    for (const f of queue.splice(0)) f();
    events.push(...sim.step(1000));
    expect(events.at(-1)).toMatchObject({ t: "run_finished", reason: "stopped" });
    expect(events.some((e) => e.t === "decision")).toBe(false);
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
    const bogus: TetrisAgent = { request: (turn, deliver) => deliver({ status: "ok", choice: "option_999" }, turn.requestedAt + 10) };
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

  // CALIBRATE=1 bun test prints how each mock profile fares, to tune profiles against the demo.
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
