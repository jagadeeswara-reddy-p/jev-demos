import { describe, expect, test } from "bun:test";
import type { ModelConfig } from "../models/types";
import { sampleTurn } from "../sample";
import { bedrockAdapter, converseInput, readConverse } from "./bedrock";

const req = sampleTurn();
const model: ModelConfig = {
  id: "b",
  label: "Bedrock model",
  adapter: "bedrock",
  model: "us.openai.gpt-6.1-sol",
  prices: { inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.1, cacheWritePerM: 3 },
};

describe("converseInput", () => {
  test("forces the answer tool by default, limited to the offered options", () => {
    const input = converseInput(model, req);
    expect(input.modelId).toBe("us.openai.gpt-6.1-sol");
    expect(input.toolConfig?.toolChoice).toEqual({ tool: { name: "choose_option" } });
    const schema = input.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json as any;
    expect(schema.properties.choice.enum).toHaveLength(req.action.options.length);
    expect(input.inferenceConfig?.maxTokens).toBe(1024);
    expect(input).not.toHaveProperty("additionalModelRequestFields");
  });

  test("offers the tool without forcing it for toolChoice auto, and passes extraBody through", () => {
    const input = converseInput({ ...model, toolChoice: "auto", maxTokens: 200, extraBody: { reasoning_effort: "low" } }, req);
    expect(input.toolConfig?.toolChoice).toEqual({ auto: {} });
    expect(input.inferenceConfig?.maxTokens).toBe(200);
    expect(input.additionalModelRequestFields).toEqual({ reasoning_effort: "low" } as any);
  });
});

describe("readConverse", () => {
  test("reads the tool call and prices cache reads and writes at their own rates", () => {
    const a = readConverse(model, {
      usage: { inputTokens: 1000, cacheReadInputTokens: 2000, cacheWriteInputTokens: 1000, outputTokens: 100, totalTokens: 4100 },
      output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "t", name: "choose_option", input: { choice: "option_4" } } }] } },
    });
    expect(a.choice).toBe("option_4");
    expect(a.usage?.inputTokens).toBe(4000);
    // 1000×2 + 2000×0.1 + 1000×3 + 100×10, per million
    expect(a.usage?.costUsd).toBeCloseTo(0.0062);
  });

  test("falls back to a JSON answer in text (toolChoice auto)", () => {
    const a = readConverse(model, { output: { message: { role: "assistant", content: [{ text: '{"choice":"option_1"}' }] } } });
    expect(a).toMatchObject({ status: "ok", choice: "option_1" });
  });

  test("cache prices default to the input price", () => {
    const a = readConverse(
      { ...model, prices: { inputPerM: 1, outputPerM: 0 } },
      { usage: { inputTokens: 0, cacheReadInputTokens: 1_000_000, outputTokens: 0, totalTokens: 0 } },
    );
    expect(a.usage?.costUsd).toBe(1);
  });
});

describe("bedrockAdapter.unavailable", () => {
  test("needs AWS credentials or a profile", () => {
    expect(bedrockAdapter.unavailable?.(model, {})).toBe("Set AWS credentials in .env");
    expect(bedrockAdapter.unavailable?.(model, { AWS_PROFILE: "dev" })).toBeUndefined();
  });
});
