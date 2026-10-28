import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArenaEvent, TetrisAgent } from "../../src/arena/types";
import { mockSourceFor } from "../../src/mock/mockSource";
import { parseBench } from "./config";
import type { BenchEntrant } from "./entrants";
import { type MatchPlan, planMatches } from "./plan";
import { type MatchOutcome, outcomeOf, quorum, type RunOptions, runMatches, writeManifest } from "./runner";

const entrant = (id: string, label: string, kind: BenchEntrant["kind"]): BenchEntrant => ({ id, label, kind, live: false });
const MOCKS = [
  entrant("jev", "Jev", "system-one"),
  entrant("llm-fast", "LLM Fast", "llm"),
  entrant("heuristic", "Heuristic", "baseline"),
  entrant("random", "Random", "baseline"),
];
const NEVER: TetrisAgent = { request() {} };

function mockAgents(plan: MatchPlan) {
  return plan.config.agents.map((spec) => mockSourceFor(plan.config, spec));
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "bench-runner-"));
}

function readEvents(file: string): ArenaEvent[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as ArenaEvent);
}

function fastOpts(outDir: string, overrides: Partial<RunOptions> = {}): RunOptions {
  return { outDir, agentsFor: mockAgents, pace: "fast", stopWhenFinished: 0.75, ...overrides };
}

describe("planMatches", () => {
  const cfg = parseBench({ name: "t", seeds: [1], clocks: ["frozen", "realtime"], tetris: { maxPieces: 40 }, models: ["jev"] });

  test("one match per clock and seed, with the entrants as agents", () => {
    const plans = planMatches(cfg, MOCKS.slice(0, 2));
    expect(plans.map((p) => p.key)).toEqual(["described-frozen-seed1", "described-realtime-seed1"]);
    const [first] = plans;
    expect(first.variant).toBe("described");
    expect(first.config.mode).toBe("frozen");
    expect(first.config.seed).toBe(1);
    expect(first.config.maxPieces).toBe(40);
    expect(first.config.targetLines).toBe(0);
    expect(first.config.agents).toEqual([
      { id: "jev", name: "Jev", kind: "system-one", sourceId: "jev" },
      { id: "llm-fast", name: "LLM Fast", kind: "llm", sourceId: "llm-fast" },
    ]);
  });

  test("sprint40 sets the line target to 40", () => {
    const sprint = parseBench({ name: "t", tetris: { goal: "sprint40" }, models: ["jev"] });
    expect(planMatches(sprint, MOCKS)[0].config.targetLines).toBe(40);
  });
});

describe("quorum", () => {
  test("rounds the share of boards up, and never below one", () => {
    expect(quorum(1, 0.75)).toBe(1);
    expect(quorum(4, 0.75)).toBe(3);
    expect(quorum(12, 0.75)).toBe(9);
    expect(quorum(2, 0.75)).toBe(2);
    expect(quorum(3, 1)).toBe(3);
  });
});

describe("runMatches", () => {
  const cfg = parseBench({ name: "t", seeds: [1], clocks: ["frozen", "realtime"], tetris: { maxPieces: 40 }, models: ["jev"] });

  test("plays every match to the end, writing one JSONL file each", async () => {
    const outDir = join(tempDir(), "nested");
    const plans = planMatches(cfg, MOCKS);
    const seen: number[] = [];
    const outcomes = await runMatches(
      plans,
      fastOpts(outDir, {
        onMatch: (o, index, total) => {
          expect(total).toBe(2);
          seen.push(index);
          expect(o.status).toBe("played");
        },
      }),
    );

    expect(outcomes.map((o) => o.status)).toEqual(["played", "played"]);
    expect(seen).toEqual([0, 1]);
    for (const plan of plans) {
      const file = join(outDir, `${plan.key}.jsonl`);
      const events = readEvents(file);
      expect(events[events.length - 1].t).toBe("run_finished");
    }
  });

  test("the stop rule ends a match once three of four boards are done", async () => {
    const stop = parseBench({ name: "t", seeds: [1], clocks: ["frozen", "realtime"], tetris: { maxPieces: 1000 }, models: ["jev"] });
    const stopEntrants = [
      entrant("s1", "S1", "baseline"),
      entrant("s2", "S2", "baseline"),
      entrant("s3", "S3", "baseline"),
      entrant("heuristic", "Heuristic", "baseline"),
    ];
    const plans = planMatches(stop, stopEntrants);
    const agentsFor = (plan: MatchPlan): TetrisAgent[] => [NEVER, NEVER, NEVER, mockSourceFor(plan.config, plan.config.agents[3])];
    const outcomes = await runMatches(plans, fastOpts(tempDir(), { agentsFor }));
    const realtime = outcomes[1];
    expect(realtime.status).toBe("played");
    expect(realtime.stoppedEarly).toBe(true);
    expect(realtime.unfinished).toHaveLength(1);
    const events = readEvents(realtime.file);
    expect(events[events.length - 1]).toMatchObject({ t: "run_finished", reason: "stopped" });
  }, 20_000);

  test("resumes a finished log and replays one cut short", async () => {
    const outDir = tempDir();
    const plans = planMatches(cfg, MOCKS);
    const full = await runMatches(plans, fastOpts(outDir));
    const frozenFile = join(outDir, `${plans[0].key}.jsonl`);
    const realtimeFile = join(outDir, `${plans[1].key}.jsonl`);
    const fullLines = readFileSync(frozenFile, "utf8").split("\n").filter(Boolean);
    writeFileSync(frozenFile, `${fullLines.slice(0, 10).join("\n")}\n`);
    const realtimeMtime = statSync(realtimeFile).mtimeMs;

    const again = await runMatches(plans, fastOpts(outDir));
    expect(again.map((o) => o.status)).toEqual(["played", "resumed"]);
    expect(again[1].costUsd).toBe(full[1].costUsd);
    expect(statSync(realtimeFile).mtimeMs).toBe(realtimeMtime);
    const replayed = readFileSync(frozenFile, "utf8").split("\n").filter(Boolean);
    expect(replayed).toHaveLength(fullLines.length);
    expect(JSON.parse(replayed[replayed.length - 1]).t).toBe("run_finished");
  });

  test("skips the matches after the cost limit is passed", async () => {
    const costly = parseBench({ name: "t", seeds: [1], clocks: ["frozen", "realtime"], tetris: { maxPieces: 40 }, models: ["jev"] });
    const plans = planMatches(costly, MOCKS);
    const payer: TetrisAgent = {
      request(turn, deliver) {
        deliver(
          { status: "ok", choice: turn.detail.candidates[0].id, usage: { inputTokens: 0, outputTokens: 0, costUsd: 1 } },
          turn.requestedAt + 10,
        );
      },
    };
    const agentsFor = (plan: MatchPlan): TetrisAgent[] => [payer, ...plan.config.agents.slice(1).map((s) => mockSourceFor(plan.config, s))];
    const outcomes = await runMatches(plans, fastOpts(tempDir(), { agentsFor, maxCostUsd: 0.5 }));
    expect(outcomes[0].status).toBe("played");
    expect(outcomes[0].costUsd).toBeGreaterThan(0.5);
    expect(outcomes[1]).toMatchObject({ status: "skipped", costUsd: 0, unfinished: [], stoppedEarly: false });
  });
});

describe("outcomeOf", () => {
  test("sums decision cost and lists boards still playing", () => {
    const config = { agents: [{ id: "a" }, { id: "b" }, { id: "c" }] };
    const events = [
      { t: "run_started", at: 0, config },
      { t: "decision", at: 1, agentId: "a", pieceId: 1, status: "ok", latencyMs: 1, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0.25 } },
      { t: "decision", at: 2, agentId: "b", pieceId: 1, status: "ok", latencyMs: 1 },
      { t: "topout", at: 3, agentId: "a", level: 1 },
      { t: "survived", at: 4, agentId: "b", level: 1, pieces: 40 },
      { t: "run_finished", at: 5, reason: "stopped" },
    ] as ArenaEvent[];
    const o = outcomeOf("k", "f.jsonl", events);
    expect(o).toEqual({ key: "k", file: "f.jsonl", stoppedEarly: true, unfinished: ["c"], costUsd: 0.25 });
  });
});

describe("writeManifest", () => {
  test("stores the config as written, placeholders included", async () => {
    const outDir = join(tempDir(), "out");
    const cfg = parseBench({
      name: "t",
      models: [{ id: "my-model", label: "My", adapter: "completion", model: "m-1", baseUrl: "https://x.test/v1", apiKey: "${K}" }],
    });
    const outcomes: MatchOutcome[] = [
      { key: "a", file: "a.jsonl", status: "played", stoppedEarly: false, unfinished: [], costUsd: 0 },
      { key: "b", file: "b.jsonl", status: "skipped", stoppedEarly: false, unfinished: [], costUsd: 0 },
    ];
    await writeManifest(outDir, cfg, outcomes);
    const text = readFileSync(join(outDir, "bench.json"), "utf8");
    expect(text).toContain('"${K}"');
    const manifest = JSON.parse(text);
    expect(manifest.name).toBe("t");
    expect(manifest.environment.id).toBe("tetris");
    expect(typeof manifest.createdAt).toBe("string");
    expect(manifest.matches).toHaveLength(2);
  });
});
