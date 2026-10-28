import type { Turn } from "../../src/core/types";
import type { ModelConfig } from "../models/types";
import { bearer, choiceSchema, httpError, parseChoice, systemText, usageOf, userText } from "./shared";
import type { Adapter } from "./types";

// Completion adapter: any OpenAI-compatible Chat Completions API (OpenAI,
// OpenRouter, Groq, Together, vLLM, Ollama, Gemini's OpenAI endpoint, ...).
// The model gets the board and the options as text and answers {"choice": "option_N"}.
//
//   POST {baseUrl}/chat/completions   (or `url`)
//   { model, messages: [system, user], response_format?, max_tokens?, ...extraBody }

export function completionBody(model: ModelConfig, turn: Turn): Record<string, unknown> {
  const mode = model.jsonMode ?? "schema";
  const responseFormat =
    mode === "schema"
      ? { type: "json_schema", json_schema: { name: "choice", strict: true, schema: choiceSchema(turn) } }
      : mode === "object"
        ? { type: "json_object" }
        : undefined;
  return {
    model: model.model,
    messages: [
      { role: "system", content: systemText(turn) },
      { role: "user", content: userText(turn) },
    ],
    ...(responseFormat && { response_format: responseFormat }),
    ...(model.maxTokens && { max_tokens: model.maxTokens }),
    ...model.extraBody,
  };
}

export const completionAdapter: Adapter = {
  kind: "llm",
  defaultTimeoutMs: 60_000,

  async decide(model, turn, signal) {
    const res = await fetch(model.url ?? `${model.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { ...bearer(model.apiKey), "Content-Type": "application/json" },
      body: JSON.stringify(completionBody(model, turn)),
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
