import type { AgentKind, AgentSpec, RunConfig, SourceInfo, TetrisAgent } from "../../src/arena/types";
import { ADAPTERS, sourceFor } from "../adapters";
import { type Env, fillEnv } from "../models/env";
import type { ModelConfig } from "../models/types";
import { ModelError, validateModel } from "../models/validate";
import { BenchConfigError, type BenchModelEntry } from "./config";

// Resolves the models listed in bench.yaml into entrants: a model id is looked up
// among the known sources, an inline model is checked and its ${ENV} placeholders
// are filled from the environment. sources.ts is not imported here (it reads
// models.json at load time); the caller passes the sources and the fallback agent.

export interface BenchEntrant {
  id: string;
  label: string;
  kind: AgentKind;
  /** Calls a real API. Any live entrant makes the bench run on the wall clock. */
  live: boolean;
  /** Inline models from bench.yaml, placeholders filled. Id-only entries resolve through `sources` instead. */
  model?: ModelConfig;
  /** Why it can't run, e.g. "Set OPENROUTER_API_KEY in .env". */
  unavailable?: string;
}

export function resolveEntrants(entries: BenchModelEntry[], sources: SourceInfo[], env: Env): BenchEntrant[] {
  return entries.map((entry, i) => (typeof entry === "string" ? fromSource(entry, i, sources) : fromInline(entry, i, env)));
}

/** The agent for one board. `spec` must be the object in `run.agents`, since mock seeding depends on its position. */
export function agentFor(
  entrant: BenchEntrant,
  run: RunConfig,
  spec: AgentSpec,
  fallback: (run: RunConfig, spec: AgentSpec) => TetrisAgent,
): TetrisAgent {
  return entrant.model ? sourceFor(entrant.model) : fallback(run, spec);
}

function fromSource(id: string, i: number, sources: SourceInfo[]): BenchEntrant {
  const source = sources.find((s) => s.id === id);
  if (!source) {
    const known = sources.map((s) => s.id).join(", ");
    throw new BenchConfigError(`models[${i}]`, `unknown model "${id}"; known: ${known}`);
  }
  const entrant: BenchEntrant = { id: source.id, label: source.label, kind: source.kind, live: source.live };
  if (!source.available) entrant.unavailable = source.reason ?? "not available";
  return entrant;
}

function fromInline(entry: Record<string, unknown>, i: number, env: Env): BenchEntrant {
  const filled = fillEnv(entry, env);
  const raw = filled.value;
  const id = String(raw.id);

  if (filled.missing.length) {
    const adapter =
      typeof raw.adapter === "string" && Object.hasOwn(ADAPTERS, raw.adapter) ? ADAPTERS[raw.adapter as keyof typeof ADAPTERS] : undefined;
    return {
      id,
      label: typeof raw.label === "string" && raw.label ? raw.label : id,
      kind: adapter?.kind ?? "llm",
      live: true,
      unavailable: `Set ${filled.missing.join(" and ")} in .env`,
    };
  }

  let model: ModelConfig;
  try {
    model = validateModel(raw, { allowBedrock: true });
  } catch (err) {
    if (err instanceof ModelError) {
      const reason = err.message.startsWith(`${err.field}: `) ? err.message.slice(err.field.length + 2) : err.message;
      throw new BenchConfigError(`models[${i}].${err.field}`, reason);
    }
    throw err;
  }
  const adapter = ADAPTERS[model.adapter];
  const entrant: BenchEntrant = { id: model.id, label: model.label, kind: adapter.kind, live: true, model };
  const unavailable = adapter.unavailable?.(model, env);
  if (unavailable) entrant.unavailable = unavailable;
  return entrant;
}
