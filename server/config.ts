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

export interface BedrockModel {
  /** Short key from BEDROCK_MODELS; the source id is `bedrock-<key>`. */
  key: string;
  /** Bedrock model or inference profile id, e.g. us.anthropic.claude-haiku-5-5. */
  modelId: string;
  label: string;
  inputPricePerM: number;
  outputPricePerM: number;
  /** Prompt-cache prices; default to the input price when not set. */
  cacheReadPricePerM: number;
  cacheWritePricePerM: number;
  /**
   * Provider-specific request fields from BEDROCK_<KEY>_EXTRA, passed as the
   * Converse API's additionalModelRequestFields, e.g. {"reasoning_effort":"low"}.
   */
  extra: Record<string, unknown>;
  /**
   * "tool" forces the choose_placement tool call. Some models reject a forced
   * tool (Claude Opus 5.5 on Bedrock does), so "auto" offers the same tool
   * without forcing it, and a plain-text JSON answer is read instead.
   */
  toolChoice: "tool" | "auto";
}

/** "gpt=us.openai.gpt-6.1-sol,claude=us.anthropic.claude-haiku-5-5" → models. */
function bedrockModels(spec: string): BedrockModel[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [key, modelId] = entry.split("=").map((s) => s.trim());
      if (!key || !modelId) throw new Error(`BEDROCK_MODELS entries look like key=model-id, got "${entry}"`);
      const K = key.toUpperCase().replace(/[^A-Z0-9]/g, "_");
      // "us.anthropic.claude-haiku-5-5" -> "claude-haiku-5-5", "us.openai.gpt-6.1-sol" -> "gpt-6.1-sol"
      const fallbackLabel = modelId
        .replace(/^(us|eu|apac|global|jp|au|ca|us-gov)\./, "")
        .replace(/^[a-z0-9-]+\./, "")
        .replace(/-v\d+(:\d+)?$/, "");
      const inputPricePerM = num(`BEDROCK_${K}_INPUT_PRICE_PER_M`, 0);
      return {
        key,
        modelId,
        label: env[`BEDROCK_${K}_LABEL`] || fallbackLabel,
        inputPricePerM,
        outputPricePerM: num(`BEDROCK_${K}_OUTPUT_PRICE_PER_M`, 0),
        cacheReadPricePerM: num(`BEDROCK_${K}_CACHE_READ_PRICE_PER_M`, inputPricePerM),
        cacheWritePricePerM: num(`BEDROCK_${K}_CACHE_WRITE_PRICE_PER_M`, inputPricePerM),
        extra: json(`BEDROCK_${K}_EXTRA`),
        toolChoice: env[`BEDROCK_${K}_TOOL_CHOICE`] === "auto" ? ("auto" as const) : ("tool" as const),
      };
    });
}

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

  /**
   * Laya, the open-source System One model, served by its own `laya-serve`
   * (Jev-compatible API). Unavailable until LAYA_BASE_URL is set.
   */
  laya: {
    baseUrl: (env.LAYA_BASE_URL ?? "").replace(/\/$/, ""),
    apiKey: env.LAYA_API_KEY ?? "",
    /** A laya-serve checkpoint name: typed-decisions, english or multilingual. */
    model: env.LAYA_MODEL || "typed-decisions",
    label: env.LAYA_LABEL || "Laya",
    /** Where it runs, shown on the board, e.g. "self-hosted on a T4". */
    host: env.LAYA_HOST_NOTE || "self-hosted",
    /**
     * Token budgets sent with every request. The full option list is about
     * 1,100 tokens, far over laya-serve's default option budget (192–256),
     * so both are raised; laya-serve caps them at its LAYA_MAX_TOKEN_BUDGET (8192).
     */
    maxLen: num("LAYA_MAX_LEN", 4096),
    headMaxLen: num("LAYA_HEAD_MAX_LEN", 2048),
    timeoutMs: num("LAYA_TIMEOUT_MS", 30_000),
    inputPricePerM: num("LAYA_INPUT_PRICE_PER_M", 0),
    outputPricePerM: num("LAYA_OUTPUT_PRICE_PER_M", 0),
  },

  bedrock: {
    region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "us-east-1",
    /** The AWS SDK reads the usual AWS_* variables (or a profile) itself. */
    hasCredentials: Boolean(env.AWS_ACCESS_KEY_ID || env.AWS_PROFILE),
    models: bedrockModels(env.BEDROCK_MODELS ?? ""),
    maxTokens: num("BEDROCK_MAX_TOKENS", 1024),
    timeoutMs: num("BEDROCK_TIMEOUT_MS", 60_000),
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
