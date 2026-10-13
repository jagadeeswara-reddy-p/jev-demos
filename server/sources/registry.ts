import type { AgentSpec, DecisionSource, RunConfig, SourceInfo } from "../../src/arena/types";
import { MOCK_SOURCES, isMockSource, mockSourceFor } from "../../src/mock/mockSource";
import { config } from "../config";
import { bedrockSource } from "./bedrock";
import { clefSource, gemmaSource, jevSource, layaSource } from "./jev";
import { llmSource } from "./llm";

// Every decision source the server can offer: the mocks, plus the live models
// whose keys are configured.

export const LIVE_JEV = "live-jev";
export const LIVE_LLM = "live-llm";
export const LIVE_LAYA = "live-laya";
export const LIVE_CLEF = "live-clef";
export const LIVE_GEMMA = "live-gemma";
const BEDROCK_PREFIX = "bedrock-";

export function listSources(): SourceInfo[] {
  const jev = config.jev;
  const laya = config.laya;
  const clef = config.clef;
  const gemma = config.gemma;
  const clefMissing = !clef.accountId ? "Set CLOUDFLARE_ACCOUNT_ID in .env" : !clef.apiToken ? "Set CLOUDFLARE_API_TOKEN in .env" : undefined;
  const llm = config.llm;
  const llmMissing = !llm.apiKey ? "Set LLM_API_KEY in .env" : !llm.model ? "Set LLM_MODEL in .env" : undefined;
  return [
    {
      id: LIVE_JEV,
      label: jev.label,
      kind: "system-one",
      description: `System One model ${jev.model}, through the TypeSafe API`,
      live: true,
      available: Boolean(jev.apiKey),
      reason: jev.apiKey ? undefined : "Set TYPESAFE_API_KEY in .env",
    },
    {
      id: LIVE_LAYA,
      label: laya.label,
      kind: "system-one",
      description: `Open-source System One model laya ${laya.model}, ${laya.host}`,
      live: true,
      available: Boolean(laya.baseUrl),
      reason: laya.baseUrl ? undefined : "Set LAYA_BASE_URL in .env and start laya-serve",
    },
    {
      id: LIVE_GEMMA,
      label: gemma.label,
      kind: "system-one",
      description: `Open-weight decision model ${gemma.model}, ${gemma.host}`,
      live: true,
      available: Boolean(gemma.baseUrl),
      reason: gemma.baseUrl ? undefined : "Set GEMMA_BASE_URL in .env and start deploy/gemma-serve",
    },
    {
      id: LIVE_CLEF,
      label: clef.label,
      kind: "system-one",
      description: `Open-weight decision model @cf/cloudflare/${clef.model}, through Cloudflare Workers AI`,
      live: true,
      available: !clefMissing,
      reason: clefMissing,
    },
    {
      id: LIVE_LLM,
      label: llm.label,
      kind: "llm",
      description: `Language model, through ${llm.provider === "anthropic" ? "the Anthropic" : "an OpenAI-compatible"} API`,
      live: true,
      available: !llmMissing,
      reason: llmMissing,
    },
    ...config.bedrock.models.map((m) => ({
      id: `${BEDROCK_PREFIX}${m.key}`,
      label: m.label,
      kind: "llm" as const,
      description: `Language model ${m.modelId}, through AWS Bedrock${settingsNote(m.extra)}`,
      live: true,
      available: config.bedrock.hasCredentials,
      reason: config.bedrock.hasCredentials ? undefined : "Set AWS credentials in .env",
    })),
    ...MOCK_SOURCES,
  ];
}

/** The live line-up's source ids, checked against what this server offers. */
export function lineup(): string[] {
  const known = new Set(listSources().map((s) => s.id));
  const unknown = config.lineup.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`LINEUP has unknown sources: ${unknown.join(", ")}`);
  return config.lineup;
}

export function createSource(run: RunConfig, spec: AgentSpec): DecisionSource {
  if (isMockSource(spec.sourceId)) return mockSourceFor(run, spec);
  if (spec.sourceId === LIVE_JEV) return jevSource();
  if (spec.sourceId === LIVE_LAYA) return layaSource();
  if (spec.sourceId === LIVE_CLEF) return clefSource();
  if (spec.sourceId === LIVE_GEMMA) return gemmaSource();
  if (spec.sourceId === LIVE_LLM) return llmSource();
  const bedrock = config.bedrock.models.find((m) => `${BEDROCK_PREFIX}${m.key}` === spec.sourceId);
  if (bedrock) return bedrockSource(bedrock);
  throw new Error(`Unknown source "${spec.sourceId}"`);
}

/** Request settings worth showing on the board, e.g. ", reasoning_effort low". */
function settingsNote(extra: Record<string, unknown>): string {
  const parts = Object.entries(extra).map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  return parts.length ? `, ${parts.join(", ")}` : "";
}
