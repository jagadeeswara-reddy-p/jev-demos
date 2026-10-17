import type { SourceInfo } from "../../src/arena/types";

// A model the arena can put on a board. Built-in models come from models.json
// (committed, keys referenced as ${ENV_VAR}); models added in the page live in
// models.local.json (git-ignored, keys stored as typed). Both have this shape.

export type AdapterName = "completion" | "decision" | "bedrock";

export interface Prices {
  /** USD per million input tokens. */
  inputPerM: number;
  /** USD per million output tokens. */
  outputPerM: number;
  /** Bedrock only: prompt-cache reads and writes, defaulting to the input price. */
  cacheReadPerM?: number;
  cacheWritePerM?: number;
}

export interface ModelConfig {
  /** Source id, used in LINEUP and run logs. Lowercase letters, digits and dashes. */
  id: string;
  /** Name on the board. */
  label: string;
  adapter: AdapterName;
  /** One line shown as the board's tooltip, e.g. where the model runs. */
  description?: string;
  /** API root, e.g. https://api.openai.com/v1 (completion) or https://api.typesafe.ai (decision). */
  baseUrl?: string;
  /** The full request address, when it isn't the adapter's usual path under baseUrl. */
  url?: string;
  /** Model name sent in the request (a Bedrock model or inference profile id for bedrock). */
  model: string;
  /** Sent as a bearer token. Not used by bedrock, which reads the AWS_* variables. */
  apiKey?: string;
  timeoutMs?: number;
  prices?: Prices;
  /**
   * A path on baseUrl that answers 200 when the server is up, e.g. "/health". Set it for
   * self-hosted models: the server pings it and shows the model as unavailable when it
   * doesn't answer, instead of letting every move wait out the timeout.
   */
  healthCheck?: string;
  /** Merged into every request body (bedrock: the Converse API's additionalModelRequestFields). */
  extraBody?: Record<string, unknown>;

  /** completion: how the answer is constrained. "schema" (strict JSON schema), "object" (JSON mode) or "none". */
  jsonMode?: "schema" | "object" | "none";
  /** completion and bedrock: the reply token limit. */
  maxTokens?: number;
  /**
   * decision: ask the same question this many times with the option order rotated,
   * and average the probabilities. Cancels a model's preference for early slots
   * (Laya documents one) at the cost of that many rows per call. 1 = off.
   */
  rotations?: number;
  /** bedrock: "tool" forces the answer tool; "auto" offers it, for models that reject a forced tool. */
  toolChoice?: "tool" | "auto";
}

/** A model as the page sees it: keys are never included, only whether one is set. */
export interface ModelInfo extends SourceInfo {
  adapter: AdapterName;
  /** Built-in models are edited in models.json, not in the page. */
  builtIn: boolean;
  /** The saved settings, as written (built-in ones keep their ${ENV_VAR} placeholders). */
  settings: Omit<ModelConfig, "apiKey"> & { hasKey: boolean };
}
