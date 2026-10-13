import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import type { DecisionAnswer, DecisionRequest } from "../../src/arena/types";
import type { ModelConfig } from "../models/types";
import type { Adapter } from "./types";
import { SYSTEM, choiceSchema, parseChoice, userText } from "./shared";

// Bedrock adapter: chat models on AWS Bedrock (OpenAI, Anthropic, ...) through
// the Converse API. Same prompt as the completion adapter; the answer comes back
// as a call to a tool whose input is limited to the offered option ids.
// Bedrock needs AWS request signing, so it can't share the completion adapter.
// It is for models.json only; the page offers the two plain HTTP adapters.
// Credentials and region come from the usual AWS_* variables (or AWS_PROFILE).

const TOOL = "choose_placement";

export function converseInput(model: ModelConfig, req: DecisionRequest): ConverseCommandInput {
  return {
    modelId: model.model,
    system: [{ text: SYSTEM }],
    messages: [{ role: "user", content: [{ text: userText(req) }] }],
    toolConfig: {
      tools: [{ toolSpec: { name: TOOL, description: "Report the chosen landing spot.", inputSchema: { json: choiceSchema(req) } } }],
      toolChoice: model.toolChoice === "auto" ? { auto: {} } : { tool: { name: TOOL } },
    },
    inferenceConfig: { maxTokens: model.maxTokens ?? 1024 },
    ...(model.extraBody && { additionalModelRequestFields: model.extraBody as ConverseCommandInput["additionalModelRequestFields"] }),
  };
}

/**
 * Bedrock reports prompt-cache reads and writes separately (it caches OpenAI
 * prompts automatically). They count as input tokens so token columns compare
 * fairly, but each kind is priced at its own rate.
 */
export function readConverse(model: ModelConfig, res: Partial<Pick<ConverseCommandOutput, "usage" | "output">>): DecisionAnswer {
  const p = model.prices ?? { inputPerM: 0, outputPerM: 0 };
  const plain = res.usage?.inputTokens ?? 0;
  const cacheRead = res.usage?.cacheReadInputTokens ?? 0;
  const cacheWrite = res.usage?.cacheWriteInputTokens ?? 0;
  const outputTokens = res.usage?.outputTokens ?? 0;
  const costUsd =
    (plain * p.inputPerM + cacheRead * (p.cacheReadPerM ?? p.inputPerM) + cacheWrite * (p.cacheWritePerM ?? p.inputPerM) + outputTokens * p.outputPerM) /
    1_000_000;
  const usage = { inputTokens: plain + cacheRead + cacheWrite, outputTokens, costUsd };
  const content = res.output?.message?.content ?? [];
  const choice = (content.find((c) => c.toolUse)?.toolUse?.input as { choice?: unknown } | undefined)?.choice;
  if (typeof choice === "string") return { status: "ok", choice, usage };
  return parseChoice(content.find((c) => c.text)?.text ?? "", usage);
}

const clients = new Map<string, BedrockRuntimeClient>();

function region(): string {
  return Bun.env.AWS_REGION ?? Bun.env.AWS_DEFAULT_REGION ?? "us-east-1";
}

export const bedrockAdapter: Adapter = {
  kind: "llm",
  defaultTimeoutMs: 60_000,

  unavailable(_model, env) {
    return env.AWS_ACCESS_KEY_ID || env.AWS_PROFILE ? undefined : "Set AWS credentials in .env";
  },

  async decide(model, req, signal) {
    const r = region();
    let client = clients.get(r);
    if (!client) clients.set(r, (client = new BedrockRuntimeClient({ region: r })));
    const res = await client.send(new ConverseCommand(converseInput(model, req)), { abortSignal: signal });
    return readConverse(model, res);
  },
};
