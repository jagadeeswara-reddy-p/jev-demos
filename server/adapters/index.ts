import type { DecisionSource } from "../../src/arena/types";
import type { AdapterName, ModelConfig } from "../models/types";
import { bedrockAdapter } from "./bedrock";
import { completionAdapter } from "./completion";
import { decisionAdapter } from "./decision";
import { liveSource } from "./shared";
import type { Adapter } from "./types";

export type { Adapter } from "./types";

export const ADAPTERS: Record<AdapterName, Adapter> = {
  completion: completionAdapter,
  decision: decisionAdapter,
  bedrock: bedrockAdapter,
};

/** A board's decision source for a model whose ${ENV} placeholders are already filled. */
export function sourceFor(model: ModelConfig): DecisionSource {
  const adapter = ADAPTERS[model.adapter];
  return liveSource((req, signal) => adapter.decide(model, req, signal), model.timeoutMs ?? adapter.defaultTimeoutMs);
}
