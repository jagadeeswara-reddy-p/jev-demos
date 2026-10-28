import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tetris } from "../../src/arena/environment";
import type { ArenaEvent, TetrisAgent } from "../../src/arena/types";
import type { BenchConfig } from "./config";
import type { MatchPlan } from "./plan";

// Plays the matches one at a time, writing each event to <outDir>/<key>.jsonl as
// it happens. A finished log is reused on the next run; a cut-short one is played
// again from the start. The stop rule ends a match once enough boards are done.

export interface MatchOutcome {
  key: string;
  file: string;
  /** "played" this time, "resumed" (a finished log was already there), or "skipped" (the cost limit was reached first). */
  status: "played" | "resumed" | "skipped";
  /** Stopped by the stop rule while boards were still playing. */
  stoppedEarly: boolean;
  /** Boards still playing when the match stopped. */
  unfinished: string[];
  costUsd: number;
}

export interface RunOptions {
  outDir: string;
  agentsFor(plan: MatchPlan): TetrisAgent[];
  /** "fast": simulated time as fast as possible (mock-only line-ups). "wall": 1:1 with the wall clock. */
  pace: "fast" | "wall";
  stopWhenFinished: number;
  maxCostUsd?: number;
  /** `index` is the match's position in the plan list, counting from 0. */
  onMatch?(outcome: MatchOutcome, index: number, total: number): void;
}

/** How many of `boards` must be done for the stop rule: at least one, rounded up. */
export function quorum(boards: number, share: number): number {
  return Math.max(1, Math.ceil(boards * share - 1e-9));
}

export function outcomeOf(key: string, file: string, events: ArenaEvent[]): Omit<MatchOutcome, "status"> {
  const started = events.find((e) => e.t === "run_started");
  const agents = started?.t === "run_started" ? started.config.agents.map((a) => a.id) : [];
  const done = new Set(events.flatMap((e) => (e.t === "topout" || e.t === "survived" || e.t === "goal" ? [e.agentId] : [])));
  const unfinished = agents.filter((id) => !done.has(id));
  const last = events[events.length - 1];
  return {
    key,
    file,
    stoppedEarly: last?.t === "run_finished" && last.reason === "stopped" && unfinished.length > 0,
    unfinished,
    costUsd: events.reduce((sum, e) => (e.t === "decision" ? sum + (e.usage?.costUsd ?? 0) : sum), 0),
  };
}

export async function runMatches(plans: MatchPlan[], opts: RunOptions): Promise<MatchOutcome[]> {
  mkdirSync(opts.outDir, { recursive: true });
  const outcomes: MatchOutcome[] = [];
  let spent = 0;
  for (const [index, plan] of plans.entries()) {
    const file = join(opts.outDir, `${plan.key}.jsonl`);
    let outcome: MatchOutcome;
    if (opts.maxCostUsd !== undefined && spent > opts.maxCostUsd) {
      outcome = { key: plan.key, file, status: "skipped", stoppedEarly: false, unfinished: [], costUsd: 0 };
    } else {
      const saved = await readFinished(file);
      if (saved) {
        outcome = { ...outcomeOf(plan.key, file, saved), status: "resumed" };
      } else {
        const events = await play(plan, file, opts);
        outcome = { ...outcomeOf(plan.key, file, events), status: "played" };
      }
    }
    spent += outcome.costUsd;
    outcomes.push(outcome);
    opts.onMatch?.(outcome, index, plans.length);
  }
  return outcomes;
}

export async function writeManifest(outDir: string, cfg: BenchConfig, outcomes: MatchOutcome[]): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const manifest = {
    name: cfg.name,
    environment: { id: tetris.id, version: tetris.version },
    createdAt: new Date().toISOString(),
    gitCommit: gitCommit(),
    config: cfg,
    matches: outcomes,
  };
  await Bun.write(join(outDir, "bench.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** The events of a log whose last line is run_finished, or null when it is missing or cut short. */
async function readFinished(file: string): Promise<ArenaEvent[] | null> {
  const f = Bun.file(file);
  if (!(await f.exists())) return null;
  const lines = (await f.text()).split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return null;
  try {
    const events = lines.map((line) => JSON.parse(line) as ArenaEvent);
    return events[events.length - 1].t === "run_finished" ? events : null;
  } catch {
    return null;
  }
}

async function play(plan: MatchPlan, file: string, opts: RunOptions): Promise<ArenaEvent[]> {
  const match = tetris.createMatch(plan.config, opts.agentsFor(plan));
  const writer = Bun.file(file).writer();
  const events: ArenaEvent[] = [];
  const done = new Set<string>();
  const need = quorum(plan.config.agents.length, opts.stopWhenFinished);
  const emit = (batch: ArenaEvent[]) => {
    for (const e of batch) {
      events.push(e);
      writer.write(`${JSON.stringify(e)}\n`);
      if (e.t === "topout" || e.t === "survived" || e.t === "goal") done.add(e.agentId);
    }
  };
  try {
    emit(match.start());
    let last = performance.now();
    while (!match.finished) {
      if (opts.pace === "fast") {
        emit(match.step(1000));
      } else {
        await Bun.sleep(10);
        const now = performance.now();
        emit(match.step(Math.min(now - last, 250)));
        last = now;
      }
      if (!match.finished && done.size >= need) emit(match.stop());
    }
  } finally {
    await writer.end();
  }
  return events;
}

function gitCommit(): string | null {
  try {
    const r = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: import.meta.dir });
    return r.exitCode === 0 ? r.stdout.toString().trim() : null;
  } catch {
    return null;
  }
}
