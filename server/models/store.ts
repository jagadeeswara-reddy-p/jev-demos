import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { MAX_BOARDS } from "../../src/arena/types";
import { ADAPTERS } from "../adapters";
import { fillEnv, type Env } from "./env";
import type { ModelConfig, ModelInfo } from "./types";
import { ModelError, slugify, validateModel } from "./validate";

// Every model the server can put on a board, and the saved line-up.
//
//   models.json         built-in models, committed; keys as ${ENV} placeholders
//   models.local.json   models added in the page and the chosen line-up;
//                       git-ignored and written with mode 600, because it holds keys
//
// Built-in models are read-only here. Keys never leave this module except to
// the adapters: what the page gets (ModelInfo) only says whether a key is set.

export const MAX_LINEUP = MAX_BOARDS;

export interface StoreOptions {
  presetsPath: string;
  localPath: string;
  env: Env;
  /** Line-up used until one is saved (LINEUP in .env). */
  defaultLineup: string[];
  /** Other source ids the server offers (the mocks): valid in a line-up, taken as model ids. */
  otherSources: string[];
}

interface LocalFile {
  lineup?: string[];
  models: ModelConfig[];
}

export class ModelStore {
  private builtIn: ModelConfig[];
  private local: LocalFile;

  constructor(private readonly opts: StoreOptions) {
    this.builtIn = readModels(opts.presetsPath);
    this.local = existsSync(opts.localPath) ? readLocal(opts.localPath) : { models: [] };
    const ids = new Set(opts.otherSources);
    for (const m of [...this.builtIn, ...this.local.models]) {
      if (ids.has(m.id)) throw new Error(`Model id "${m.id}" is used twice (models.json, models.local.json or a mock)`);
      ids.add(m.id);
    }
  }

  /** Every model as the page sees it, built-in first. */
  list(): ModelInfo[] {
    return [...this.builtIn.map((m) => this.info(m, true)), ...this.local.models.map((m) => this.info(m, false))];
  }

  get(id: string): ModelInfo | undefined {
    return this.list().find((m) => m.id === id);
  }

  has(id: string): boolean {
    return this.all().some((m) => m.id === id);
  }

  /** The model ready for its adapter, placeholders filled. Throws when it can't run. */
  resolve(id: string): ModelConfig {
    const raw = this.all().find((m) => m.id === id);
    if (!raw) throw new Error(`Unknown model "${id}"`);
    const reason = this.unavailable(raw);
    if (reason) throw new Error(`${raw.label} can't run: ${reason}`);
    return fillEnv(raw, this.opts.env).value;
  }

  /** Adds a model from the page. The id comes from the label unless given. */
  add(input: unknown): ModelInfo {
    const draft = isObject(input) ? { ...input } : input;
    if (isObject(draft) && !draft.id && typeof draft.label === "string") draft.id = this.freeId(slugify(draft.label));
    const model = validateModel(draft);
    if (this.taken(model.id)) throw new ModelError("id", `"${model.id}" is already used`);
    this.local.models.push(model);
    this.save();
    return this.info(model, false);
  }

  /** Replaces a page-added model's settings. A blank apiKey keeps the saved one. */
  update(id: string, input: unknown): ModelInfo {
    const i = this.local.models.findIndex((m) => m.id === id);
    if (i < 0) throw new ModelError("id", this.builtIn.some((m) => m.id === id) ? "built-in models are edited in models.json" : `no model "${id}"`);
    const draft = isObject(input) ? { ...input, id } : input;
    if (isObject(draft) && !draft.apiKey && this.local.models[i].apiKey) draft.apiKey = this.local.models[i].apiKey;
    const model = validateModel(draft);
    this.local.models[i] = model;
    this.save();
    return this.info(model, false);
  }

  remove(id: string): void {
    const i = this.local.models.findIndex((m) => m.id === id);
    if (i < 0) throw new ModelError("id", this.builtIn.some((m) => m.id === id) ? "built-in models are removed in models.json" : `no model "${id}"`);
    this.local.models.splice(i, 1);
    if (this.local.lineup) this.local.lineup = this.local.lineup.filter((x) => x !== id);
    this.save();
  }

  /** The saved line-up, or LINEUP from .env, without ids that no longer exist. */
  lineup(): string[] {
    const known = (id: string) => this.has(id) || this.opts.otherSources.includes(id);
    return (this.local.lineup ?? this.opts.defaultLineup).filter(known).slice(0, MAX_LINEUP);
  }

  setLineup(ids: unknown): string[] {
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) throw new ModelError("lineup", "must be a list of model ids");
    if (ids.length < 1 || ids.length > MAX_LINEUP) throw new ModelError("lineup", `pick 1 to ${MAX_LINEUP} models`);
    const unknown = ids.filter((id) => !this.has(id) && !this.opts.otherSources.includes(id));
    if (unknown.length) throw new ModelError("lineup", `unknown models: ${unknown.join(", ")}`);
    this.local.lineup = ids as string[];
    this.save();
    return this.lineup();
  }

  private all(): ModelConfig[] {
    return [...this.builtIn, ...this.local.models];
  }

  private taken(id: string): boolean {
    return this.has(id) || this.opts.otherSources.includes(id);
  }

  private freeId(base: string): string {
    if (!this.taken(base)) return base;
    for (let n = 2; ; n++) if (!this.taken(`${base}-${n}`)) return `${base}-${n}`;
  }

  private unavailable(m: ModelConfig): string | undefined {
    const { value, missing } = fillEnv(m, this.opts.env);
    if (missing.length) return `Set ${missing.join(" and ")} in .env`;
    return ADAPTERS[m.adapter].unavailable?.(value, this.opts.env);
  }

  private info(m: ModelConfig, builtIn: boolean): ModelInfo {
    const filled = fillEnv({ label: m.label, description: m.description, apiKey: m.apiKey }, this.opts.env).value;
    const reason = this.unavailable(m);
    const { apiKey, ...settings } = m;
    return {
      id: m.id,
      label: filled.label || m.id,
      kind: ADAPTERS[m.adapter].kind,
      description: filled.description || `${m.model}, through the ${m.adapter} adapter`,
      live: true,
      available: !reason,
      reason,
      adapter: m.adapter,
      builtIn,
      settings: { ...settings, hasKey: Boolean(apiKey && filled.apiKey) },
    };
  }

  private save() {
    const tmp = `${this.opts.localPath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.local, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.opts.localPath);
  }
}

function readModels(path: string): ModelConfig[] {
  const file = readJson(path);
  if (!isObject(file) || !Array.isArray(file.models)) throw new Error(`${path} must have a "models" list`);
  return file.models.map((m, i) => checked(path, i, m));
}

function readLocal(path: string): LocalFile {
  const file = readJson(path);
  if (!isObject(file)) throw new Error(`${path} must be a JSON object`);
  const models = Array.isArray(file.models) ? file.models.map((m, i) => checked(path, i, m)) : [];
  const lineup = Array.isArray(file.lineup) ? file.lineup.filter((x): x is string => typeof x === "string") : undefined;
  return { models, ...(lineup && { lineup }) };
}

function checked(path: string, i: number, m: unknown): ModelConfig {
  try {
    return validateModel(m, { allowBedrock: true });
  } catch (err) {
    throw new Error(`${path}, model ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Couldn't read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
