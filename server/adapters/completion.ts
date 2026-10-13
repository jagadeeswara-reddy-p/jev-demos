import type { DecisionRequest } from "../../src/arena/types";
import type { ModelConfig } from "../models/types";
import type { Adapter } from "./types";
import { SYSTEM, bearer, choiceSchema, httpError, parseChoice, userText, usageOf } from "./shared";

// Completion adapter: any OpenAI-compatible Chat Completions API (OpenAI,
// OpenRouter, Groq, Together, vLLM, Ollama, Gemini's OpenAI endpoint, ...).
// The model gets the board and the options as text and answers {"choice": "option_N"}.
//
//   POST {baseUrl}/chat/completions   (or `url`)
//   { model, messages: [system, user], response_format?, max_tokens?, ...extraBody }

export function completionBody(model: ModelConfig, req: DecisionRequest): Record<string, unknown> {
  const mode = model.jsonMode ?? "schema";
  const responseFormat =
    mode === "schema"
      ? { type: "json_schema", json_schema: { name: "placement", strict: true, schema: choiceSchema(req) } }
      : mode === "object"
        ? { type: "json_object" }
        : undefined;
  return {
    model: model.model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userText(req) },
    ],
    ...(responseFormat && { response_format: responseFormat }),
    ...(model.maxTokens && { max_tokens: model.maxTokens }),
    ...model.extraBody,
  };
}

export const completionAdapter: Adapter = {
  kind: "llm",
  defaultTimeoutMs: 60_000,

  async decide(model, req, signal) {
    const res = await fetch(model.url ?? `${model.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { ...bearer(model.apiKey), "Content-Type": "application/json" },
      body: JSON.stringify(completionBody(model, req)),
      signal,
    });
    if (!res.ok) return httpError(model.label, res);

    const body = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const usage = usageOf(body.usage?.prompt_tokens ?? 0, body.usage?.completion_tokens ?? 0, model.prices);
    return parseChoice(body.choices?.[0]?.message?.content ?? "", usage);
  },
};
