// Server settings, read once from the environment. Bun loads .env automatically.
// Keys stay on the server: nothing in here is ever sent to the browser.

const env = Bun.env;

function num(name: string, fallback: number): number {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${v}"`);
  return n;
}

function json(name: string): Record<string, unknown> {
  const v = env[name];
  if (!v) return {};
  try {
    return JSON.parse(v);
  } catch {
    throw new Error(`${name} must be a JSON object, got "${v}"`);
  }
}

export type LlmProvider = "openai" | "anthropic";

export const config = {
  port: num("PORT", 5317),
  runsDir: env.RUNS_DIR ?? "runs",
  /** The boards in the live line-up, left to right, as source ids. */
  lineup: (env.LINEUP ?? "live-jev,live-llm")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  production: env.NODE_ENV === "production",

  jev: {
    apiKey: env.TYPESAFE_API_KEY ?? "",
    baseUrl: (env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai").replace(/\/$/, ""),
    model: env.TYPESAFE_MODEL ?? "jev-latest",
    label: env.TYPESAFE_LABEL || "Jev",
    timeoutMs: num("TYPESAFE_TIMEOUT_MS", 30_000),
    inputPricePerM: num("TYPESAFE_INPUT_PRICE_PER_M", 0.042),
    outputPricePerM: num("TYPESAFE_OUTPUT_PRICE_PER_M", 0),
  },

  llm: {
    provider: (env.LLM_PROVIDER ?? "openai") as LlmProvider,
    apiKey: env.LLM_API_KEY ?? "",
    baseUrl: (env.LLM_BASE_URL ?? (env.LLM_PROVIDER === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1")).replace(/\/$/, ""),
    model: env.LLM_MODEL ?? "",
    /** Shown on the board. Defaults to the model name. */
    label: env.LLM_LABEL || env.LLM_MODEL || "LLM",
    /** openai provider: "schema" (strict JSON schema), "object" (JSON mode) or "none". */
    jsonMode: (env.LLM_JSON_MODE ?? "schema") as "schema" | "object" | "none",
    maxTokens: env.LLM_MAX_TOKENS ? num("LLM_MAX_TOKENS", 0) : undefined,
    /** Merged into every request body, for provider-specific options such as reasoning effort. */
    extraBody: json("LLM_EXTRA_BODY"),
    timeoutMs: num("LLM_TIMEOUT_MS", 60_000),
    inputPricePerM: num("LLM_INPUT_PRICE_PER_M", 0),
    outputPricePerM: num("LLM_OUTPUT_PRICE_PER_M", 0),
  },
};
