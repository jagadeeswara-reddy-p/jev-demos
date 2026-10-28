import { type AgentSpec, DEFAULT_CONFIG, type RunConfig } from "../../src/arena/types";
import type { BenchConfig } from "./config";
import type { BenchEntrant } from "./entrants";

// The matches a bench runs, in order: variants, then clocks, then seeds. Each
// entrant plays as one board, with its id and label as the agent's id and name.

export interface MatchPlan {
  key: string;
  variant: string;
  config: RunConfig;
  /** Share of boards that must be done for the stop rule. Frozen matches play to the end, so this is 1. */
  stopShare: number;
}

/** Pieces each board places in a frozen match: frozenPieces for survive, maxPieces for a sprint, which ends at 40 lines. */
export function frozenPiecesFor(cfg: BenchConfig): number {
  return cfg.goal === "sprint40" ? cfg.maxPieces : cfg.frozenPieces;
}

export function planMatches(cfg: BenchConfig, entrants: BenchEntrant[]): MatchPlan[] {
  const agents: AgentSpec[] = entrants.map((e) => ({ id: e.id, name: e.label, kind: e.kind, sourceId: e.id }));
  const plans: MatchPlan[] = [];
  for (const variant of cfg.variants) {
    for (const clock of cfg.clocks) {
      for (const seed of cfg.seeds) {
        const frozen = clock === "frozen";
        const framePieces = frozenPiecesFor(cfg);
        plans.push({
          key: `${variant}-${clock}-seed${seed}`,
          variant,
          config: {
            ...DEFAULT_CONFIG,
            seed,
            mode: clock,
            targetLines: cfg.goal === "sprint40" ? 40 : 0,
            maxDurationMs: frozen ? framePieces * (DEFAULT_CONFIG.frozenTimeoutMs + 1000) : cfg.maxDurationMs,
            maxPieces: frozen ? framePieces : cfg.maxPieces,
            agents: agents.map((a) => ({ ...a })),
          },
          stopShare: frozen ? 1 : cfg.stopWhenFinished,
        });
      }
    }
  }
  return plans;
}
