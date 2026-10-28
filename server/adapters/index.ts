import type { Agent } from "../../src/core/types";
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

/** The agent for a model whose ${ENV} placeholders are already filled. */
export function sourceFor(model: ModelConfig): Agent {
  const adapter = ADAPTERS[model.adapter];
  return liveSource((turn, signal) => adapter.decide(model, turn, signal), model.timeoutMs ?? adapter.defaultTimeoutMs);
}
