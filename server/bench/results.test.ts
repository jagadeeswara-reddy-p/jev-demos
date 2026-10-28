import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { mockSourceFor } from "../../src/mock/mockSource";
import { parseBench } from "./config";
import { type MatchPlan, planMatches } from "./plan";
import { summarizeBench } from "./results";
import { runMatches } from "./runner";

type Line = Record<string, unknown>;

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "bench-results-"));
}

/** Writes one log per call, ending with run_finished, like the runner does. */
function writeLog(dir: string, file: string, events: Line[]): void {
  const lines = [...events, { t: "run_finished", at: 0, reason: "all_out" }];
  writeFileSync(join(dir, file), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
}

function agent(id: string, name: string, kind: string) {
  return { id, name, kind, sourceId: id };
}

function startedLine(mode: "frozen" | "realtime", seed: number, agents: ReturnType<typeof agent>[]): Line {
  return {
    t: "run_started",
    at: 0,
    config: {
      mode,
      seed,
      maxPieces: mode === "frozen" ? 30 : 100,
      maxDurationMs: mode === "frozen" ? 30 * 31_000 : 120_000,
      agents,
    },
  };
}

function decision(agentId: string, latencyMs: number, extra: Line = {}): Line {
  return { t: "decision", at: 0, agentId, pieceId: 1, status: "ok", latencyMs, ...extra };
}

function usage(costUsd: number): Line {
  return { inputTokens: 0, outputTokens: 0, costUsd };
}

function lock(agentId: string, rows: number[], byDecision = true): Line {
  return { t: "lock", at: 0, agentId, pieceId: 1, type: "T", cells: [], rows, byDecision, board: "" };
}

describe("summarizeBench", () => {
  // Frozen seed 1: a answers 2 graded, 1 at rank 1 (50%); seed 2: 4 of 4 (100%).
  // Realtime: a lands 10 then 20 (mean 15); b lands 2 then 1 with 1 of 4 locks late (25%).
  function mainFolder(): string {
    const dir = tempDir();
    const agents = [agent("a", "Model A", "system-one"), agent("b", "Model B", "llm")];
    writeLog(dir, "described-frozen-seed1.jsonl", [
      startedLine("frozen", 1, agents),
      decision("a", 100, { bestRank: 1 }),
      decision("a", 200, { bestRank: 2, usage: usage(0.25) }),
      lock("a", [0, 1]),
      decision("b", 150, { bestRank: 1, usage: usage(0.1) }),
    ]);
    writeLog(dir, "described-frozen-seed2.jsonl", [
      startedLine("frozen", 2, agents),
      decision("a", 300, { bestRank: 1 }),
      decision("a", 400, { bestRank: 1 }),
      decision("a", 500, { bestRank: 1 }),
      decision("a", 600, { bestRank: 1 }),
      lock("a", [0]),
    ]);
    writeLog(dir, "described-realtime-seed1.jsonl", [
      startedLine("realtime", 1, agents),
      decision("a", 50, { usage: usage(0.5) }),
      ...Array.from({ length: 10 }, () => lock("a", [])),
      lock("b", []),
      lock("b", []),
    ]);
    writeLog(dir, "described-realtime-seed2.jsonl", [
      startedLine("realtime", 2, agents),
      ...Array.from({ length: 20 }, () => lock("a", [])),
      lock("b", []),
      lock("b", [], false),
    ]);
    return dir;
  }

  test("averages frozen judgement per seed, not pooled: a gets 75 where pooling gives 83.3", async () => {
    const summary = await summarizeBench(mainFolder());
    const a = summary.models.find((m) => m.id === "a");
    expect(a?.agreement).toBe(75);
    expect(a?.seeds).toBe(2);
  });

  test("means the frozen lines cleared, and the real-time pieces landed", async () => {
    const summary = await summarizeBench(mainFolder());
    const a = summary.models.find((m) => m.id === "a");
    expect(a?.frozenLines).toBe(1.5);
    expect(a?.realtimeLanded).toBe(15);
    expect(a?.tooLate).toBe(0);
  });

  test("pools the real-time late share over the locks, and means the pieces landed", async () => {
    const summary = await summarizeBench(mainFolder());
    const b = summary.models.find((m) => m.id === "b");
    expect(b?.realtimeLanded).toBe(1.5);
    expect(b?.tooLate).toBe(25);
  });

  test("takes the median latency over every decision, and sums the costs of all matches", async () => {
    const summary = await summarizeBench(mainFolder());
    const a = summary.models.find((m) => m.id === "a");
    // Seven decisions: 50, 100, 200, 300, 400, 500, 600.
    expect(a?.medianMs).toBe(300);
    expect(a?.costUsd).toBeCloseTo(0.75, 10);
    expect(summary.totalCostUsd).toBeCloseTo(0.85, 10);
  });

  test("takes the seeds, frozen pieces and real-time seconds from the run configs", async () => {
    const summary = await summarizeBench(mainFolder());
    expect(summary.seeds).toBe(2);
    expect(summary.frozenPieces).toBe(30);
    expect(summary.realtimeSeconds).toBe(120);
  });

  test("orders the models by real-time pieces landed, most first, and the baseline last", async () => {
    const dir = tempDir();
    const agents = [agent("ref", "Reference", "baseline"), agent("slow", "Slow", "llm"), agent("fast", "Fast", "system-one")];
    writeLog(dir, "described-realtime-seed1.jsonl", [
      startedLine("realtime", 1, agents),
      ...Array.from({ length: 30 }, () => lock("ref", [])),
      ...Array.from({ length: 5 }, () => lock("fast", [])),
      ...Array.from({ length: 2 }, () => lock("slow", [])),
    ]);
    const summary = await summarizeBench(dir);
    expect(summary.models.map((m) => m.id)).toEqual(["fast", "slow", "ref"]);
    expect(summary.models.at(-1)?.kind).toBe("baseline");
  });

  test("with only real-time logs, the frozen fields are null for every model", async () => {
    const dir = tempDir();
    const agents = [agent("a", "Model A", "system-one"), agent("b", "Model B", "llm")];
    writeLog(dir, "described-realtime-seed1.jsonl", [startedLine("realtime", 1, agents), lock("a", []), lock("b", [], false)]);
    const summary = await summarizeBench(dir);
    expect(summary.frozenPieces).toBeNull();
    expect(summary.realtimeSeconds).toBe(120);
    for (const m of summary.models) {
      expect(m.agreement).toBeNull();
      expect(m.frozenLines).toBeNull();
      expect(m.realtimeLanded).not.toBeNull();
    }
  });

  test("names the bench, its environment and date from bench.json when it is there", async () => {
    const dir = tempDir();
    writeLog(dir, "described-realtime-seed1.jsonl", [startedLine("realtime", 1, [agent("a", "Model A", "llm")])]);
    writeFileSync(
      join(dir, "bench.json"),
      JSON.stringify({ name: "Nightly", environment: { id: "tetris", version: "3" }, createdAt: "2026-10-27T12:00:00.000Z" }),
    );
    const summary = await summarizeBench(dir);
    expect(summary.name).toBe("Nightly");
    expect(summary.environment).toBe("tetris v3");
    expect(summary.date).toBe("2026-10-27");
  });

  test("falls back to settings.json for the environment, and to the folder for the name and date", async () => {
    const dir = tempDir();
    writeLog(dir, "described-realtime-seed1.jsonl", [startedLine("realtime", 1, [agent("a", "Model A", "llm")])]);
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ stopWhenFinished: 0.75, environment: { id: "tetris", version: "2" } }));
    const withSettings = await summarizeBench(dir);
    expect(withSettings.environment).toBe("tetris v2");
    expect(withSettings.name).toBe(basename(dir));
    expect(withSettings.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const bare = tempDir();
    writeLog(bare, "described-realtime-seed1.jsonl", [startedLine("realtime", 1, [agent("a", "Model A", "llm")])]);
    const plain = await summarizeBench(bare);
    expect(plain.environment).toBe("tetris");
    expect(plain.name).toBe(basename(bare));
  });

  test("a folder with no logs throws", async () => {
    const dir = tempDir();
    await expect(summarizeBench(dir)).rejects.toThrow(`${dir} has no match logs`);
  });

  test("summarizes a folder the real runner wrote, with mock entrants", async () => {
    const outDir = tempDir();
    const cfg = parseBench({ name: "smoke", seeds: [1, 2], clocks: ["frozen", "realtime"], tetris: { maxPieces: 40 }, models: ["jev"] });
    const entrants = [
      { id: "jev", label: "Jev", kind: "system-one" as const, live: false },
      { id: "heuristic", label: "Heuristic", kind: "baseline" as const, live: false },
    ];
    const plans: MatchPlan[] = planMatches(cfg, entrants);
    await runMatches(plans, {
      outDir,
      agentsFor: (plan) => plan.config.agents.map((s) => mockSourceFor(plan.config, s)),
      pace: "fast",
      stopWhenFinished: 0.75,
    });

    const summary = await summarizeBench(outDir);
    expect(summary.seeds).toBe(2);
    expect(summary.models).toHaveLength(2);
    expect(summary.models.at(-1)?.id).toBe("heuristic");
    const jev = summary.models.find((m) => m.id === "jev");
    expect(jev?.agreement).toBeGreaterThanOrEqual(0);
    expect(jev?.agreement).toBeLessThanOrEqual(100);
    expect(jev?.frozenLines).not.toBeNull();
    expect(jev?.realtimeLanded).not.toBeNull();
  }, 30_000);
});

describe("summarizeBench: unfinished logs, torn lines and mock models", () => {
  /** Writes the events as they are, with no run_finished line: a run cut short. */
  function writeCut(dir: string, file: string, events: Line[], tail = ""): void {
    writeFileSync(join(dir, file), `${events.map((l) => JSON.stringify(l)).join("\n")}\n${tail}`);
  }

  test("a log cut short (no run_finished) is left out and named in skipped; the others still count", async () => {
    const dir = tempDir();
    const agents = [agent("a", "Model A", "llm")];
    writeLog(dir, "described-realtime-seed1.jsonl", [startedLine("realtime", 1, agents), lock("a", [])]);
    writeCut(dir, "described-realtime-seed2.jsonl", [startedLine("realtime", 2, agents), ...Array.from({ length: 50 }, () => lock("a", []))]);
    const summary = await summarizeBench(dir);
    expect(summary.skipped).toEqual(["described-realtime-seed2.jsonl"]);
    expect(summary.seeds).toBe(1);
    expect(summary.models.find((m) => m.id === "a")?.realtimeLanded).toBe(1);
  });

  test("a log whose last line is half written is skipped, not thrown", async () => {
    const dir = tempDir();
    const agents = [agent("a", "Model A", "llm")];
    writeCut(dir, "described-realtime-seed1.jsonl", [startedLine("realtime", 1, agents), lock("a", [])], '{"t":"lock","at":0,"agentId":"a"');
    writeLog(dir, "described-realtime-seed2.jsonl", [startedLine("realtime", 2, agents), lock("a", [])]);
    const summary = await summarizeBench(dir);
    expect(summary.skipped).toEqual(["described-realtime-seed1.jsonl"]);
    expect(summary.seeds).toBe(1);
  });

  test("a line that is not JSON in the middle of a log throws, naming the file and the line", async () => {
    const dir = tempDir();
    const agents = [agent("a", "Model A", "llm")];
    const lines = [startedLine("realtime", 1, agents), "not json", lock("a", []), { t: "run_finished", at: 0, reason: "all_out" }];
    writeFileSync(join(dir, "described-realtime-seed1.jsonl"), `${lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n")}\n`);
    await expect(summarizeBench(dir)).rejects.toThrow("described-realtime-seed1.jsonl: line 2 is not valid JSON");
  });

  test("when every log is cut short, it throws that no log finished", async () => {
    const dir = tempDir();
    writeCut(dir, "described-realtime-seed1.jsonl", [startedLine("realtime", 1, [agent("a", "Model A", "llm")])]);
    await expect(summarizeBench(dir)).rejects.toThrow(`${dir} has no finished match logs`);
  });

  test("a mock model is flagged, keeps its own cost, and is left out of the total cost", async () => {
    const dir = tempDir();
    const agents = [agent("jev", "Jev", "system-one"), agent("acme", "Acme", "llm"), agent("heuristic", "Heuristic", "baseline")];
    writeLog(dir, "described-realtime-seed1.jsonl", [
      startedLine("realtime", 1, agents),
      decision("jev", 300, { usage: usage(0.5) }),
      decision("acme", 900, { usage: usage(0.25) }),
      lock("acme", []),
    ]);
    const summary = await summarizeBench(dir);
    const byId = (id: string) => summary.models.find((m) => m.id === id);
    expect(byId("jev")?.mock).toBe(true);
    expect(byId("jev")?.costUsd).toBeCloseTo(0.5, 10);
    expect(byId("acme")?.mock).toBe(false);
    expect(byId("heuristic")?.mock).toBe(true);
    expect(summary.totalCostUsd).toBeCloseTo(0.25, 10);
  });
});
