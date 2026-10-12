import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import type { DecisionSource } from "../../src/arena/types";
import { config, type BedrockModel } from "../config";
import { liveSource } from "./live";
import { SYSTEM, choiceSchema, parseChoice, userText } from "./llm";

// Any chat model on AWS Bedrock (OpenAI, Anthropic, ...) through the Converse API,
// which has one request shape for every provider. Same prompt as the other
// language models; the answer comes back as a forced tool call whose input is
// limited to the offered option ids.

let client: BedrockRuntimeClient | null = null;

export function bedrockSource(model: BedrockModel): DecisionSource {
  client ??= new BedrockRuntimeClient({ region: config.bedrock.region });
  const bedrock = client;
  return liveSource(async (req, signal) => {
    const res = await bedrock.send(
      new ConverseCommand({
        modelId: model.modelId,
        system: [{ text: SYSTEM }],
        messages: [{ role: "user", content: [{ text: userText(req) }] }],
        toolConfig: {
          tools: [
            {
              toolSpec: {
                name: "choose_placement",
                description: "Report the chosen landing spot.",
                inputSchema: { json: choiceSchema(req) },
              },
            },
          ],
          toolChoice: model.toolChoice === "auto" ? { auto: {} } : { tool: { name: "choose_placement" } },
        },
        inferenceConfig: { maxTokens: config.bedrock.maxTokens },
        ...(Object.keys(model.extra).length ? { additionalModelRequestFields: model.extra as ConverseCommandInput["additionalModelRequestFields"] } : {}),
      }),
      { abortSignal: signal },
    );
    // Bedrock reports prompt-cache reads and writes separately (it caches OpenAI
    // prompts automatically). They count as input tokens so token columns compare
    // fairly, but each kind is priced at its own rate.
    const plain = res.usage?.inputTokens ?? 0;
    const cacheRead = res.usage?.cacheReadInputTokens ?? 0;
    const cacheWrite = res.usage?.cacheWriteInputTokens ?? 0;
    const outputTokens = res.usage?.outputTokens ?? 0;
    const costUsd =
      (plain * model.inputPricePerM +
        cacheRead * model.cacheReadPricePerM +
        cacheWrite * model.cacheWritePricePerM +
        outputTokens * model.outputPricePerM) /
      1_000_000;
    const usage = { inputTokens: plain + cacheRead + cacheWrite, outputTokens, costUsd };
    const content = res.output?.message?.content ?? [];
    const choice = (content.find((c) => c.toolUse)?.toolUse?.input as { choice?: unknown } | undefined)?.choice;
    if (typeof choice === "string") return { status: "ok", choice, usage };
    return parseChoice(content.find((c) => c.text)?.text ?? "", usage);
  }, config.bedrock.timeoutMs);
}
