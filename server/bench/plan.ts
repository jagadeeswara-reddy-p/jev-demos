import { type AgentSpec, DEFAULT_CONFIG, type RunConfig } from "../../src/arena/types";
import type { BenchConfig } from "./config";
import type { BenchEntrant } from "./entrants";

// The matches a bench runs, in order: variants, then clocks, then seeds. Each
// entrant plays as one board, with its id and label as the agent's id and name.

export interface MatchPlan {
  key: string;
  variant: string;
  config: RunConfig;
}

export function planMatches(cfg: BenchConfig, entrants: BenchEntrant[]): MatchPlan[] {
  const agents: AgentSpec[] = entrants.map((e) => ({ id: e.id, name: e.label, kind: e.kind, sourceId: e.id }));
  const plans: MatchPlan[] = [];
  for (const variant of cfg.variants) {
    for (const clock of cfg.clocks) {
      for (const seed of cfg.seeds) {
        plans.push({
          key: `${variant}-${clock}-seed${seed}`,
          variant,
          config: {
            ...DEFAULT_CONFIG,
            seed,
            mode: clock,
            targetLines: cfg.goal === "sprint40" ? 40 : 0,
            maxDurationMs: cfg.maxDurationMs,
            maxPieces: cfg.maxPieces,
            agents: agents.map((a) => ({ ...a })),
          },
        });
      }
    }
  }
  return plans;
}
