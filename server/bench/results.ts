import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { AgentSpec, ArenaEvent, ArenaEventOf, ClockMode, RunConfig } from "../../src/arena/types";
import { MOCK_PROFILES } from "../../src/mock/profiles";

// Summarizes one bench folder per model, averaged over seeds. Only run_started,
// decision, lock and run_finished events are read; a log without run_started is
// not a match and is skipped. A log whose run never finished (no run_finished as
// its last event) is left out and listed in skipped.

const MOCK_IDS = new Set<string>(MOCK_PROFILES.map((p) => p.id));

export interface ModelSummary {
  id: string;
  label: string;
  kind: string;
  /** True when the id is a mock profile's id, so its numbers are simulated. Baselines are mock profiles too. */
  mock: boolean;
  /** Distinct seeds this model played. */
  seeds: number;
  /** Mean over frozen matches of (answers ranked 1 / graded answers), as a percentage; null without frozen matches. */
  agreement: number | null;
  /** Mean over frozen matches of lines cleared; null without frozen matches. */
  frozenLines: number | null;
  /** Median latencyMs over every decision event of the model, all matches; null if none. */
  medianMs: number | null;
  /** Mean over realtime matches of locks with byDecision; null without realtime matches. */
  realtimeLanded: number | null;
  /** Share of realtime locks not byDecision, pooled over realtime matches, as a percentage; null without realtime matches. */
  tooLate: number | null;
  /** Sum of decision usage.costUsd, all matches. */
  costUsd: number;
}

export interface BenchSummary {
  /** From bench.json if present, else the folder name. */
  name: string;
  /** e.g. "tetris v3", from bench.json or settings.json, else "tetris". */
  environment: string;
  /** Distinct seeds across matches. */
  seeds: number;
  /** maxPieces of a frozen match, null if none. */
  frozenPieces: number | null;
  /** maxDurationMs / 1000 of a realtime match, null if none. */
  realtimeSeconds: number | null;
  /** Sum of the costs of the non-mock models, all matches. */
  totalCostUsd: number;
  /** File names of the logs left out because their run never finished. */
  skipped: string[];
  /** YYYY-MM-DD of bench.json createdAt, else of the newest log's mtime. */
  date: string;
  /** Ordered by real-time pieces landed, most first; the baseline last. */
  models: ModelSummary[];
}

type RunStarted = ArenaEventOf<"run_started">;
type Decision = ArenaEventOf<"decision">;
type Lock = ArenaEventOf<"lock">;

interface Match {
  mode: ClockMode;
  config: RunConfig;
  events: ArenaEvent[];
}

const USED = new Set<ArenaEvent["t"]>(["run_started", "decision", "lock", "run_finished"]);

export async function summarizeBench(dir: string): Promise<BenchSummary> {
  const names = (await readdir(dir)).filter((f) => f.endsWith(".jsonl")).sort();
  const matches: Match[] = [];
  const skipped: string[] = [];
  let newest = 0;
  for (const name of names) {
    const file = join(dir, name);
    const { events, complete } = parseLog(await Bun.file(file).text(), name);
    const started = events.find((e): e is RunStarted => e.t === "run_started");
    if (!started) continue;
    if (!complete) {
      skipped.push(name);
      continue;
    }
    matches.push({ mode: started.config.mode, config: started.config, events });
    newest = Math.max(newest, (await stat(file)).mtimeMs);
  }
  if (matches.length === 0) throw new Error(skipped.length > 0 ? `${dir} has no finished match logs` : `${dir} has no match logs`);

  const bench = await readJson<{ name?: string; environment?: Environment; createdAt?: string }>(join(dir, "bench.json"));
  const settings = await readJson<{ environment?: Environment }>(join(dir, "settings.json"));
  const env = bench?.environment ?? settings?.environment;

  const agents = new Map<string, AgentSpec>();
  for (const m of matches) for (const a of m.config.agents) if (!agents.has(a.id)) agents.set(a.id, a);

  const models = [...agents.values()].map((spec) => summarizeModel(spec, matches));
  // Stable sort: ties keep the order the agents first appear in.
  models.sort((a, b) => Number(a.kind === "baseline") - Number(b.kind === "baseline") || (b.realtimeLanded ?? 0) - (a.realtimeLanded ?? 0));

  const frozen = matches.find((m) => m.mode === "frozen");
  const realtime = matches.find((m) => m.mode === "realtime");
  const stamp = bench?.createdAt ?? new Date(newest).toISOString();
  return {
    name: bench?.name ?? basename(resolve(dir)),
    environment: env?.id ? (env.version ? `${env.id} v${env.version}` : env.id) : "tetris",
    seeds: new Set(matches.map((m) => m.config.seed)).size,
    frozenPieces: frozen ? frozen.config.maxPieces : null,
    realtimeSeconds: realtime ? realtime.config.maxDurationMs / 1000 : null,
    totalCostUsd: matches.reduce((sum, m) => sum + costOf(m.events, (agentId) => !MOCK_IDS.has(agentId ?? "")), 0),
    skipped,
    date: stamp.slice(0, 10),
    models,
  };
}

interface Environment {
  id?: string;
  version?: string;
}

function summarizeModel(spec: AgentSpec, all: Match[]): ModelSummary {
  const id = spec.id;
  const mine = all.filter((m) => m.config.agents.some((a) => a.id === id));
  const frozen = mine.filter((m) => m.mode === "frozen");
  const realtime = mine.filter((m) => m.mode === "realtime");

  const agreements = frozen.flatMap((m) => {
    const graded = decisionsOf(m, id).filter((d) => d.bestRank !== undefined);
    return graded.length ? [(100 * graded.filter((d) => d.bestRank === 1).length) / graded.length] : [];
  });
  const frozenLines = frozen.map((m) => locksOf(m, id).reduce((n, l) => n + l.rows.length, 0));
  const landed = realtime.map((m) => locksOf(m, id).filter((l) => l.byDecision).length);
  const rtLocks = realtime.flatMap((m) => locksOf(m, id));
  const latencies = mine.flatMap((m) => decisionsOf(m, id).map((d) => d.latencyMs));

  return {
    id,
    label: spec.name,
    kind: spec.kind,
    mock: MOCK_IDS.has(id),
    seeds: new Set(mine.map((m) => m.config.seed)).size,
    agreement: mean(agreements),
    frozenLines: mean(frozenLines),
    medianMs: median(latencies),
    realtimeLanded: mean(landed),
    tooLate: realtime.length ? lateShare(rtLocks) : null,
    costUsd: mine.reduce((sum, m) => sum + costOf(m.events, (agentId) => agentId === id), 0),
  };
}

function decisionsOf(m: Match, agentId: string): Decision[] {
  return m.events.filter((e): e is Decision => e.t === "decision" && e.agentId === agentId);
}

/** Percentage of locks that did not land by decision; 0 when there are no locks. */
function lateShare(locks: Lock[]): number {
  return locks.length ? (100 * locks.filter((l) => !l.byDecision).length) / locks.length : 0;
}

function locksOf(m: Match, agentId: string): Lock[] {
  return m.events.filter((e): e is Lock => e.t === "lock" && e.agentId === agentId);
}

function costOf(events: ArenaEvent[], include: (agentId: string | undefined) => boolean): number {
  return events.reduce((sum, e) => (e.t === "decision" && include(e.agentId) ? sum + (e.usage?.costUsd ?? 0) : sum), 0);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** The middle value of the sorted list (the upper one when the count is even), as the prototype takes it. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * The events of one log that the summary reads, and whether its run finished (its last event is run_finished).
 * A line that is not JSON throws, naming the file and line. The exception is a torn last line of a log that
 * never finished: it just marks the log as cut short.
 */
function parseLog(text: string, file: string): { events: ArenaEvent[]; complete: boolean } {
  const lines = text
    .split("\n")
    .map((line, i) => ({ n: i + 1, line }))
    .filter((l) => l.line.trim() !== "");
  const events: ArenaEvent[] = [];
  let last: ArenaEvent["t"] | undefined;
  for (const [k, { n, line }] of lines.entries()) {
    let event: ArenaEvent;
    try {
      event = JSON.parse(line) as ArenaEvent;
    } catch {
      if (k === lines.length - 1 && last !== "run_finished") break;
      throw new Error(`${file}: line ${n} is not valid JSON`);
    }
    last = event.t;
    if (USED.has(event.t)) events.push(event);
  }
  return { events, complete: last === "run_finished" };
}

async function readJson<T>(file: string): Promise<T | null> {
  const f = Bun.file(file);
  return (await f.exists()) ? ((await f.json()) as T) : null;
}
