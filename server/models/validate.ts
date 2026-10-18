import type { AdapterName, ModelConfig, Prices } from "./types";

// Checks model settings from models.json, models.local.json or the page, and
// says exactly which field is wrong. Returns a cleaned copy: strings trimmed,
// trailing slashes dropped from addresses, empty optional fields removed.

export class ModelError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
  }
}

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_ROTATIONS = 64;

const ADAPTERS: AdapterName[] = ["completion", "decision", "bedrock"];
const COMMON = ["id", "label", "adapter", "description", "baseUrl", "url", "model", "apiKey", "timeoutMs", "prices", "extraBody", "healthCheck"];
const ONLY: Record<AdapterName, string[]> = {
  completion: ["jsonMode", "maxTokens"],
  decision: ["rotations"],
  bedrock: ["maxTokens", "toolChoice"],
};

export interface ValidateOptions {
  /** The page may only add the two documented adapters; bedrock is for models.json. */
  allowBedrock?: boolean;
}

export function validateModel(input: unknown, options: ValidateOptions = {}): ModelConfig {
  if (!isObject(input)) throw new ModelError("model", "must be a JSON object");
  const adapter = input.adapter;
  const allowed = options.allowBedrock ? ADAPTERS : ADAPTERS.filter((a) => a !== "bedrock");
  if (typeof adapter !== "string" || !allowed.includes(adapter as AdapterName)) {
    throw new ModelError("adapter", `must be one of ${allowed.join(", ")}`);
  }
  const a = adapter as AdapterName;
  for (const key of Object.keys(input)) {
    if (COMMON.includes(key) || ONLY[a].includes(key)) continue;
    const owner = ADAPTERS.find((x) => ONLY[x].includes(key));
    throw new ModelError(key, owner ? `only applies to the ${owner} adapter` : "is not a model setting");
  }

  const model: ModelConfig = {
    id: text(input, "id", { required: true, max: 40 }),
    label: text(input, "label", { required: true, max: 40 }),
    adapter: a,
    model: text(input, "model", { required: true, max: 200 }),
  };
  if (!ID_PATTERN.test(model.id)) throw new ModelError("id", "use lowercase letters, digits and dashes (up to 40)");

  const description = text(input, "description", { max: 200 });
  if (description) model.description = description;
  const baseUrl = address(input, "baseUrl");
  if (baseUrl) model.baseUrl = baseUrl;
  const url = address(input, "url");
  if (url) model.url = url;
  if (a !== "bedrock" && !baseUrl && !url) throw new ModelError("baseUrl", "is required (or give the full url)");
  const apiKey = text(input, "apiKey", { max: 4000 });
  if (apiKey) model.apiKey = apiKey;

  const healthCheck = text(input, "healthCheck", { max: 200 });
  if (healthCheck) {
    if (!healthCheck.startsWith("/")) throw new ModelError("healthCheck", 'must be a path on the API address, such as "/health"');
    model.healthCheck = healthCheck;
  }
  if (input.timeoutMs !== undefined) model.timeoutMs = integer(input, "timeoutMs", 1_000, 600_000);
  if (input.prices !== undefined) model.prices = prices(input.prices, a);
  if (input.extraBody !== undefined) {
    if (!isObject(input.extraBody)) throw new ModelError("extraBody", "must be a JSON object");
    if (Object.keys(input.extraBody).length) model.extraBody = input.extraBody;
  }

  if (input.jsonMode !== undefined) model.jsonMode = oneOf(input, "jsonMode", ["schema", "object", "none"] as const);
  if (input.maxTokens !== undefined) model.maxTokens = integer(input, "maxTokens", 1, 200_000);
  if (input.rotations !== undefined) model.rotations = integer(input, "rotations", 1, MAX_ROTATIONS);
  if (input.toolChoice !== undefined) model.toolChoice = oneOf(input, "toolChoice", ["tool", "auto"] as const);
  return model;
}

/** "My Qwen 3 (vLLM)" → "my-qwen-3-vllm", for ids of models added in the page. */
export function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 34)
      .replace(/-+$/, "") || "model"
  );
}

function text(o: Record<string, unknown>, field: string, opts: { required?: boolean; max: number }): string {
  const v = o[field];
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new ModelError(field, "is required");
    return "";
  }
  if (typeof v !== "string") throw new ModelError(field, "must be text");
  const s = v.trim();
  if (opts.required && !s) throw new ModelError(field, "is required");
  if (s.length > opts.max) throw new ModelError(field, `must be at most ${opts.max} characters`);
  return s;
}

/** Why a filled-in address isn't a usable http(s) address, or undefined when it is (or is absent). */
export function addressProblem(v: string | undefined): string | undefined {
  if (!v) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? undefined : "must start with http:// or https://";
  } catch {
    return "must be a full address such as http://10.0.0.5:8000";
  }
}

/** An http(s) address. Placeholders (${NAME}) are checked once filled (ModelStore), so they pass here. */
function address(o: Record<string, unknown>, field: string): string {
  const s = text(o, field, { max: 2000 }).replace(/\/+$/, "");
  if (!s || s.includes("${")) return s;
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    throw new ModelError(field, "must be a full address such as https://api.example.com/v1");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new ModelError(field, "must start with http:// or https://");
  return s;
}

function integer(o: Record<string, unknown>, field: string, min: number, max: number): number {
  const v = o[field];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new ModelError(field, `must be a whole number from ${min} to ${max}`);
  }
  return v;
}

function oneOf<T extends string>(o: Record<string, unknown>, field: string, values: readonly T[]): T {
  const v = o[field];
  if (typeof v !== "string" || !values.includes(v as T)) throw new ModelError(field, `must be one of ${values.join(", ")}`);
  return v as T;
}

function prices(v: unknown, adapter: AdapterName): Prices {
  if (!isObject(v)) throw new ModelError("prices", 'must be an object such as {"inputPerM": 0.5, "outputPerM": 1.5}');
  const keys = adapter === "bedrock" ? ["inputPerM", "outputPerM", "cacheReadPerM", "cacheWritePerM"] : ["inputPerM", "outputPerM"];
  for (const key of Object.keys(v)) if (!keys.includes(key)) throw new ModelError(`prices.${key}`, "is not a price setting");
  const out: Prices = { inputPerM: 0, outputPerM: 0 };
  for (const key of keys) {
    const n = v[key];
    if (n === undefined) continue;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new ModelError(`prices.${key}`, "must be a number, 0 or more");
    out[key as keyof Prices] = n;
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
