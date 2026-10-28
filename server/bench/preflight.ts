import { DEFAULT_CONFIG } from "../../src/arena/types";
import type { TestResult } from "../sample";
import type { BenchConfig } from "./config";
import type { BenchEntrant } from "./entrants";

// Checks every entrant before a bench starts, and estimates how long and how much
// the whole bench can take. The estimate is an upper bound: matches stop early when
// enough boards finish, and fast-pace matches take no wall-clock time.

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  latencyMs?: number;
  costUsd?: number;
}

export interface Estimate {
  matches: number;
  pace: "fast" | "wall";
  maxMinutes: number;
  maxCostUsd: number;
}

/** One real answer per live entrant, all at once. Mocks pass without a call; unavailable entrants fail without one. */
export async function preflight(entrants: BenchEntrant[], test: (e: BenchEntrant) => Promise<TestResult>): Promise<Check[]> {
  return Promise.all(entrants.map((e) => check(e, test)));
}

async function check(e: BenchEntrant, test: (e: BenchEntrant) => Promise<TestResult>): Promise<Check> {
  if (e.unavailable) return { id: e.id, label: e.label, ok: false, detail: e.unavailable };
  if (!e.live) return { id: e.id, label: e.label, ok: true, detail: "mock, no API calls" };
  try {
    const r = await test(e);
    const ok = r.status === "ok";
    return {
      id: e.id,
      label: e.label,
      ok,
      detail: ok ? `chose ${r.choice} from ${r.options} options` : (r.detail ?? r.status),
      latencyMs: r.latencyMs,
      costUsd: r.usage?.costUsd ?? 0,
    };
  } catch (err) {
    return { id: e.id, label: e.label, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export function estimate(cfg: BenchConfig, entrants: BenchEntrant[], checks: Check[]): Estimate {
  const matches = cfg.variants.length * cfg.clocks.length * cfg.seeds.length;
  const pace = paceFor(entrants);
  const maxMinutes = pace === "wall" ? (matches * cfg.maxDurationMs) / 60_000 : 0;
  const live = new Set(entrants.filter((e) => e.live).map((e) => e.id));

  let perMatch = 0;
  for (const c of checks) {
    if (!c.ok || !live.has(c.id)) continue;
    const turnMs = (c.latencyMs ?? 0) + DEFAULT_CONFIG.entryDelayMs;
    const turns = Math.min(cfg.maxPieces, Math.ceil(cfg.maxDurationMs / turnMs));
    perMatch += (c.costUsd ?? 0) * turns * matches;
  }
  return { matches, pace, maxMinutes, maxCostUsd: perMatch };
}

export function paceFor(entrants: BenchEntrant[]): "fast" | "wall" {
  return entrants.some((e) => e.live) ? "wall" : "fast";
}

export function formatChecks(checks: Check[]): string {
  const width = Math.max(0, ...checks.map((c) => c.label.length));
  return checks
    .map((c) => {
      const latency = c.latencyMs === undefined ? "" : `${Math.round(c.latencyMs)} ms`;
      return `${c.ok ? "✓" : "✗"} ${c.label.padEnd(width)}  ${latency.padStart(8)}  ${c.detail}`.trimEnd();
    })
    .join("\n");
}

export function formatEstimate(e: Estimate): string {
  if (e.pace === "fast") return `${e.matches} matches, fast pace: needs no waiting and costs nothing`;
  return `${e.matches} matches, wall-clock pace: at most ${Math.ceil(e.maxMinutes)} min and ${usd(e.maxCostUsd)}`;
}

/** Rounds up to the next cent, so the printed figure never undershoots. */
function usd(v: number): string {
  const cents = Math.ceil(Math.round(v * 1e6) / 1e4) / 100;
  return `$${cents.toFixed(2)}`;
}
