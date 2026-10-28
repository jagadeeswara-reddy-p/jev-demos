import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tetris } from "../../src/arena/environment";
import type { ArenaEvent, TetrisAgent } from "../../src/arena/types";
import { isCoreEvent } from "../../src/core/types";
import type { BenchConfig } from "./config";
import type { MatchPlan } from "./plan";

// Plays the matches one at a time. A match's events are buffered and written to
// <outDir>/<key>.jsonl when the match ends, so a crash mid-match loses that match's
// log and the next run plays it again. A finished log is reused on the next run;
// a cut-short one is played again from the start. The stop rule ends a match once
// enough boards are done.

/** A finished log or folder that was made by a different bench: the run stops rather than mix results. */
export class ResumeMismatchError extends Error {}

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
  /** The ids of the agents whose costs are real spend (live models). Mock costs are play money and are left out of the cap. */
  paidAgents?: readonly string[];
  /** `index` is the match's position in the plan list, counting from 0. */
  onMatch?(outcome: MatchOutcome, index: number, total: number): void;
}

/** How many of `boards` must be done for the stop rule: at least one, rounded up. */
export function quorum(boards: number, share: number): number {
  return Math.max(1, Math.ceil(boards * share - 1e-9));
}

/** `paid`, when given, is the agents whose answer costs count; without it every agent's cost counts. */
export function outcomeOf(key: string, file: string, events: { t: string }[], paid?: ReadonlySet<string>): Omit<MatchOutcome, "status"> {
  const core = events.filter(isCoreEvent);
  const started = core.find((e) => e.t === "run_started");
  const agents = started?.t === "run_started" ? started.config.agents.map((a) => a.id) : [];
  const done = new Set(core.flatMap((e) => (e.t === "episode_finished" ? [e.agentId] : [])));
  const last = core[core.length - 1];
  const stopped = last?.t === "run_finished" && last.reason === "stopped";
  // Only a stop says which boards were still playing; a time limit ends without a per-board event.
  const unfinished = stopped ? agents.filter((id) => !done.has(id)) : [];
  return {
    key,
    file,
    stoppedEarly: stopped && unfinished.length > 0,
    unfinished,
    costUsd: core.reduce((sum, e) => (e.t === "decision" && (!paid || paid.has(e.agentId)) ? sum + (e.usage?.costUsd ?? 0) : sum), 0),
  };
}

export async function runMatches(plans: MatchPlan[], opts: RunOptions): Promise<MatchOutcome[]> {
  mkdirSync(opts.outDir, { recursive: true });
  await checkSettings(opts.outDir, opts.stopWhenFinished);
  const outcomes: MatchOutcome[] = [];
  const paid = opts.paidAgents ? new Set(opts.paidAgents) : undefined;
  let spent = 0;
  for (const [index, plan] of plans.entries()) {
    const file = join(opts.outDir, `${plan.key}.jsonl`);
    let outcome: MatchOutcome;
    if (opts.maxCostUsd !== undefined && spent > opts.maxCostUsd) {
      outcome = { key: plan.key, file, status: "skipped", stoppedEarly: false, unfinished: [], costUsd: 0 };
    } else {
      const saved = await readFinished(file);
      if (saved) {
        assertSameRun(file, saved, plan);
        outcome = { ...outcomeOf(plan.key, file, saved, paid), status: "resumed" };
      } else {
        const events = await play(plan, file, opts);
        outcome = { ...outcomeOf(plan.key, file, events, paid), status: "played" };
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

const SETTINGS = "settings.json";

/** Refuses a folder that was run with another stop share; otherwise records this one for the next run. */
async function checkSettings(outDir: string, stopWhenFinished: number): Promise<void> {
  const file = Bun.file(join(outDir, SETTINGS));
  if (await file.exists()) {
    const saved = (await file.json()) as { stopWhenFinished?: number };
    if (saved.stopWhenFinished !== stopWhenFinished) {
      throw new ResumeMismatchError(`${outDir} was run with stopWhenFinished ${saved.stopWhenFinished}; use --out <new folder> or delete it`);
    }
  }
  await Bun.write(file, `${JSON.stringify({ stopWhenFinished }, null, 2)}\n`);
}

/** A finished log is only reused for the same line-up and settings; anything else is refused and left as it is. */
function assertSameRun(file: string, events: ArenaEvent[], plan: MatchPlan): void {
  const started = events[0];
  if (started.t !== "run_started" || JSON.stringify(started.config) !== JSON.stringify(plan.config)) {
    throw new ResumeMismatchError(`${file} was played with different models or settings; use --out <new folder> or delete it`);
  }
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
      if (isCoreEvent(e) && e.t === "episode_finished") done.add(e.agentId);
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
