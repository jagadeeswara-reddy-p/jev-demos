import { tetris } from "../../src/arena/environment";
import type { ClockMode } from "../../src/arena/types";
import { ID_PATTERN } from "../models/validate";

// Reads and checks bench.yaml. Every error names the field that is wrong. Inline
// models are only checked for their shape here; entrants.ts checks them once the
// environment is filled in, since their addresses may still be placeholders.

export const BENCH_MAX_MODELS = 12;

/** A model id (built-in, page-added or mock) or an inline model, as written: placeholders kept. */
export type BenchModelEntry = string | Record<string, unknown>;

export interface BenchConfig {
  name: string;
  environment: "tetris";
  seeds: number[];
  clocks: ClockMode[];
  variants: string[];
  goal: "survive" | "sprint40";
  maxDurationMs: number;
  maxPieces: number;
  stopWhenFinished: number;
  maxCostUsd?: number;
  models: BenchModelEntry[];
}

export class BenchConfigError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
  }
}

const TOP_KEYS = ["name", "environment", "seeds", "clocks", "variants", "tetris", "limits", "models"];
const TETRIS_KEYS = ["goal", "maxDurationMs", "maxPieces"];
const LIMIT_KEYS = ["stopWhenFinished", "maxCostUsd"];
const CLOCKS: ClockMode[] = ["frozen", "realtime"];
const GOALS = ["survive", "sprint40"] as const;
// An api key is ${NAME}, ${NAME:-} or ${NAME:-${OTHER}}: a literal default could hold a key.
const API_KEY_PLACEHOLDER = /^\$\{[A-Z0-9_]+(:-(\$\{[A-Z0-9_]+\})?)?\}$/;

/** Checks a bench definition (already parsed from YAML or JSON) and fills in the defaults. */
export function parseBench(raw: unknown): BenchConfig {
  if (!isObject(raw)) throw new BenchConfigError("bench", "must be a mapping of settings");
  unknownKeys(raw, TOP_KEYS, "");

  const name = raw.name;
  if (typeof name !== "string" || !ID_PATTERN.test(name)) {
    throw new BenchConfigError("name", "use lowercase letters, digits and dashes (up to 40)");
  }
  if (raw.environment !== undefined && raw.environment !== "tetris") {
    throw new BenchConfigError("environment", 'must be "tetris"');
  }

  const tet = section(raw.tetris, "tetris", TETRIS_KEYS);
  const lim = section(raw.limits, "limits", LIMIT_KEYS);

  const config: BenchConfig = {
    name,
    environment: "tetris",
    seeds: seeds(raw.seeds),
    clocks: clocks(raw.clocks),
    variants: variants(raw.variants),
    goal: tet.goal === undefined ? "survive" : oneOf(tet.goal, "tetris.goal", GOALS),
    maxDurationMs: tet.maxDurationMs === undefined ? 600_000 : integer(tet.maxDurationMs, "tetris.maxDurationMs", 10_000, 3_600_000),
    maxPieces: tet.maxPieces === undefined ? 1000 : integer(tet.maxPieces, "tetris.maxPieces", 1, 10_000),
    stopWhenFinished: lim.stopWhenFinished === undefined ? 0.75 : stopShare(lim.stopWhenFinished),
    models: models(raw.models),
  };
  if (lim.maxCostUsd !== undefined) {
    if (typeof lim.maxCostUsd !== "number" || !(lim.maxCostUsd > 0) || !Number.isFinite(lim.maxCostUsd)) {
      throw new BenchConfigError("limits.maxCostUsd", "must be a number greater than 0");
    }
    config.maxCostUsd = lim.maxCostUsd;
  }
  return config;
}

/**
 * Reads a .json file as JSON, anything else as YAML. A file that cannot be read or
 * parsed is a BenchConfigError whose field is the path; validation errors pass through.
 */
export async function loadBench(path: string): Promise<BenchConfig> {
  let raw: unknown;
  try {
    const text = await Bun.file(path).text();
    raw = path.endsWith(".json") ? JSON.parse(text) : Bun.YAML.parse(text);
  } catch (err) {
    throw new BenchConfigError(path, err instanceof Error ? err.message : String(err));
  }
  return parseBench(raw);
}

function seeds(v: unknown): number[] {
  if (v === undefined) return range(5);
  if (typeof v === "number") return range(integer(v, "seeds", 1, 100));
  if (!Array.isArray(v) || v.length < 1 || v.length > 100) {
    throw new BenchConfigError("seeds", "must be a number from 1 to 100, or a list of 1 to 100 whole numbers");
  }
  for (const s of v) {
    if (typeof s !== "number" || !Number.isInteger(s) || s < 0) throw new BenchConfigError("seeds", "must be whole numbers, 0 or more");
  }
  if (new Set(v).size !== v.length) throw new BenchConfigError("seeds", "must not repeat a seed");
  return [...v];
}

function clocks(v: unknown): ClockMode[] {
  if (v === undefined) return [...CLOCKS];
  if (!Array.isArray(v) || v.length === 0) throw new BenchConfigError("clocks", "must be a list of frozen and realtime");
  for (const c of v) {
    if (!CLOCKS.includes(c)) throw new BenchConfigError("clocks", `unknown clock ${String(c)}; use frozen or realtime`);
  }
  return CLOCKS.filter((c) => v.includes(c));
}

function variants(v: unknown): string[] {
  if (v === undefined) return ["described"];
  if (!Array.isArray(v) || v.length === 0) throw new BenchConfigError("variants", "must be a non-empty list");
  for (const name of v) {
    if (typeof name !== "string" || !tetris.variants.includes(name)) {
      throw new BenchConfigError("variants", `unknown variant ${String(name)}; tetris has ${tetris.variants.join(", ")}`);
    }
  }
  if (new Set(v).size !== v.length) throw new BenchConfigError("variants", "must not repeat a variant");
  return [...v];
}

function models(v: unknown): BenchModelEntry[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > BENCH_MAX_MODELS) {
    throw new BenchConfigError("models", `must list 1 to ${BENCH_MAX_MODELS} models`);
  }
  const seen = new Set<string>();
  v.forEach((entry, i) => {
    const at = `models[${i}]`;
    let id: unknown;
    if (typeof entry === "string") {
      id = entry;
    } else if (isObject(entry)) {
      id = entry.id;
      if (entry.apiKey !== undefined && !(typeof entry.apiKey === "string" && API_KEY_PLACEHOLDER.test(entry.apiKey))) {
        throw new BenchConfigError(`${at}.apiKey`, "must be an ${ENV} placeholder; put the key itself in .env");
      }
    } else {
      throw new BenchConfigError(at, "must be a model id or an inline model");
    }
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      throw new BenchConfigError(isObject(entry) ? `${at}.id` : at, "use lowercase letters, digits and dashes (up to 40)");
    }
    if (seen.has(id)) throw new BenchConfigError(at, `repeats the model id ${id}`);
    seen.add(id);
  });
  return v as BenchModelEntry[];
}

function stopShare(v: unknown): number {
  if (typeof v !== "number" || !(v > 0 && v <= 1)) throw new BenchConfigError("limits.stopWhenFinished", "must be more than 0 and at most 1");
  return v;
}

function section(v: unknown, field: string, allowed: string[]): Record<string, unknown> {
  if (v === undefined) return {};
  if (!isObject(v)) throw new BenchConfigError(field, "must be a mapping of settings");
  unknownKeys(v, allowed, field);
  return v;
}

function unknownKeys(o: Record<string, unknown>, allowed: string[], prefix: string): void {
  for (const key of Object.keys(o)) {
    if (!allowed.includes(key)) throw new BenchConfigError(prefix ? `${prefix}.${key}` : key, "is not a bench setting");
  }
}

function integer(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new BenchConfigError(field, `must be a whole number from ${min} to ${max}`);
  }
  return v;
}

function oneOf<T extends string>(v: unknown, field: string, values: readonly T[]): T {
  if (typeof v !== "string" || !values.includes(v as T)) throw new BenchConfigError(field, `must be one of ${values.join(", ")}`);
  return v as T;
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
