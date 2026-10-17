import { afterAll, describe, expect, test } from "bun:test";
import type { ModelConfig } from "../models/types";
import { sampleRequest } from "../sample";
import { completionAdapter, completionBody } from "./completion";

const req = sampleRequest();
const base: ModelConfig = { id: "c", label: "Fake chat", adapter: "completion", model: "fake-1", prices: { inputPerM: 2, outputPerM: 10 } };

// An OpenAI-compatible API that records requests and replies with the test's content.
let reply: { status?: number; content?: string | null; usage?: object } = {};
const seen: { path: string; auth: string | null; body: any }[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(r) {
    seen.push({ path: new URL(r.url).pathname, auth: r.headers.get("authorization"), body: await r.json() });
    if (reply.status) return new Response("rate limited", { status: reply.status });
    return Response.json({ choices: [{ message: { content: reply.content } }], usage: reply.usage });
  },
});
afterAll(() => server.stop(true));
const model = (extra: Partial<ModelConfig> = {}): ModelConfig => ({ ...base, baseUrl: `http://localhost:${server.port}/v1`, ...extra });
const signal = () => new AbortController().signal;

describe("completionBody", () => {
  test("sends the system prompt, the board and options, and a strict schema by default", () => {
    const body = completionBody(base, req) as any;
    expect(body.messages.map((m: any) => m.role)).toEqual(["system", "user"]);
    expect(body.messages[1].content).toContain("option_1:");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.schema.properties.choice.enum).toHaveLength(req.candidates.length);
    expect(body).not.toHaveProperty("max_tokens");
  });

  test("follows jsonMode, maxTokens and extraBody", () => {
    expect((completionBody({ ...base, jsonMode: "object" }, req) as any).response_format).toEqual({ type: "json_object" });
    expect(completionBody({ ...base, jsonMode: "none" }, req)).not.toHaveProperty("response_format");
    expect(completionBody({ ...base, maxTokens: 64, extraBody: { reasoning_effort: "low" } }, req)).toMatchObject({
      max_tokens: 64,
      reasoning_effort: "low",
    });
  });
});

describe("completionAdapter.decide", () => {
  test("posts to /chat/completions and reads the JSON choice", async () => {
    reply = { content: '{"choice":"option_5"}', usage: { prompt_tokens: 1000, completion_tokens: 100 } };
    const a = await completionAdapter.decide(model({ apiKey: "sk-1" }), req, signal());
    expect(a).toMatchObject({ status: "ok", choice: "option_5", usage: { inputTokens: 1000, outputTokens: 100, costUsd: 0.003 } });
    expect(seen.at(-1)).toMatchObject({ path: "/v1/chat/completions", auth: "Bearer sk-1" });
  });

  test("accepts JSON in a code fence, rejects free text", async () => {
    reply = { content: '```json\n{"choice":"option_2"}\n```' };
    expect((await completionAdapter.decide(model(), req, signal())).choice).toBe("option_2");
    reply = { content: "I would go with option 2." };
    const a = await completionAdapter.decide(model(), req, signal());
    expect(a.status).toBe("invalid");
    expect(a.detail).toContain("Not a JSON choice");
  });

  test("an empty reply is invalid, not an error", async () => {
    reply = { content: null };
    expect((await completionAdapter.decide(model(), req, signal())).status).toBe("invalid");
  });

  test("turns an HTTP error into an error answer naming the model", async () => {
    reply = { status: 429 };
    const a = await completionAdapter.decide(model(), req, signal());
    expect(a).toMatchObject({ status: "error", detail: "Fake chat returned 429: rate limited" });
  });
});
