import type { AgentSpec, DecisionSource, RunConfig, SourceInfo } from "../../src/arena/types";
import { MOCK_SOURCES, isMockSource, mockSourceFor } from "../../src/mock/mockSource";
import { config } from "../config";
import { jevSource } from "./jev";
import { llmSource } from "./llm";

// Every decision source the server can offer: the mocks, plus the live models
// whose keys are configured.

export const LIVE_JEV = "live-jev";
export const LIVE_LLM = "live-llm";

export function listSources(): SourceInfo[] {
  const jev = config.jev;
  const llm = config.llm;
  const llmMissing = !llm.apiKey ? "Set LLM_API_KEY in .env" : !llm.model ? "Set LLM_MODEL in .env" : undefined;
  return [
    {
      id: LIVE_JEV,
      label: jev.label,
      kind: "system-one",
      description: "System One model, live through the TypeSafe API",
      live: true,
      available: Boolean(jev.apiKey),
      reason: jev.apiKey ? undefined : "Set TYPESAFE_API_KEY in .env",
    },
    {
      id: LIVE_LLM,
      label: llm.label,
      kind: "llm",
      description: "Language model, live through its provider's API",
      live: true,
      available: !llmMissing,
      reason: llmMissing,
    },
    ...MOCK_SOURCES,
  ];
}

export function createSource(run: RunConfig, spec: AgentSpec): DecisionSource {
  if (isMockSource(spec.sourceId)) return mockSourceFor(run, spec);
  if (spec.sourceId === LIVE_JEV) return jevSource();
  if (spec.sourceId === LIVE_LLM) return llmSource();
  throw new Error(`Unknown source "${spec.sourceId}"`);
}
