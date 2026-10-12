import { TASK, optionDescriptions, stateText } from "../../src/arena/prompt";
import type { DecisionAnswer, DecisionRequest, DecisionSource } from "../../src/arena/types";
import { config } from "../config";
import { cost, httpError, liveSource } from "./live";

// A regular chat model, asked for {"choice": "option_N"}. Two wire formats cover
// most providers: OpenAI-compatible chat completions (OpenAI, OpenRouter, Groq,
// Together, vLLM, Ollama, Gemini's OpenAI endpoint, ...) and Anthropic Messages.
// Which model it is stays in .env, so the UI can keep it unnamed.

export const SYSTEM = `${TASK} Reply with JSON only, in the form {"choice": "<option id>"}.`;

export function userText(req: DecisionRequest): string {
  const options = Object.entries(optionDescriptions(req))
    .map(([id, text]) => `${id}: ${text}`)
    .join("\n");
  return `${stateText(req)}\n\nOptions:\n${options}`;
}

export function choiceSchema(req: DecisionRequest) {
  return {
    type: "object",
    properties: { choice: { type: "string", enum: req.candidates.map((c) => c.id) } },
    required: ["choice"],
    additionalProperties: false,
  };
}

export function llmSource(): DecisionSource {
  const c = config.llm;
  const call = c.provider === "anthropic" ? anthropic : openaiCompatible;
  return liveSource(call, c.timeoutMs);
}

async function openaiCompatible(req: DecisionRequest, signal: AbortSignal): Promise<DecisionAnswer> {
  const c = config.llm;
  const responseFormat =
    c.jsonMode === "schema"
      ? { type: "json_schema", json_schema: { name: "placement", strict: true, schema: choiceSchema(req) } }
      : c.jsonMode === "object"
        ? { type: "json_object" }
        : undefined;
  const res = await fetch(`${c.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: c.model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userText(req) },
      ],
      ...(responseFormat && { response_format: responseFormat }),
      ...(c.maxTokens && { max_tokens: c.maxTokens }),
      ...c.extraBody,
    }),
    signal,
  });
  if (!res.ok) return httpError("LLM API", res);

  const body = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const usage = usageOf(body.usage?.prompt_tokens, body.usage?.completion_tokens);
  return parseChoice(body.choices?.[0]?.message?.content ?? "", usage);
}

async function anthropic(req: DecisionRequest, signal: AbortSignal): Promise<DecisionAnswer> {
  const c = config.llm;
  // Forcing the tool guarantees a structured answer, but Anthropic doesn't allow
  // it alongside extended thinking, so fall back to "auto" when thinking is on.
  const thinking = "thinking" in c.extraBody;
  const res = await fetch(`${c.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": c.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: c.model,
      max_tokens: c.maxTokens ?? 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: userText(req) }],
      tools: [{ name: "choose_placement", description: "Report the chosen landing spot.", input_schema: choiceSchema(req) }],
      tool_choice: thinking ? { type: "auto" } : { type: "tool", name: "choose_placement" },
      ...c.extraBody,
    }),
    signal,
  });
  if (!res.ok) return httpError("Anthropic API", res);

  const body = (await res.json()) as {
    content?: ({ type: "tool_use"; input?: { choice?: unknown } } | { type: "text"; text: string } | { type: string })[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const usage = usageOf(body.usage?.input_tokens, body.usage?.output_tokens);
  const tool = body.content?.find((b) => b.type === "tool_use") as { input?: { choice?: unknown } } | undefined;
  if (tool && typeof tool.input?.choice === "string") return { status: "ok", choice: tool.input.choice, usage };
  const text = body.content?.find((b) => b.type === "text") as { text?: string } | undefined;
  return parseChoice(text?.text ?? "", usage);
}

/** Strict: the answer must be JSON naming an option. No guessing from free text. */
export function parseChoice(text: string, usage: DecisionAnswer["usage"]): DecisionAnswer {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(cleaned) as { choice?: unknown };
    if (typeof parsed.choice === "string") return { status: "ok", choice: parsed.choice, usage };
  } catch {
    // A model that may answer in text sometimes wraps the JSON in a sentence; take the object if there is exactly one.
    const found = cleaned.match(/\{\s*"choice"\s*:\s*"[^"]*"\s*\}/g);
    if (found?.length === 1) return { status: "ok", choice: (JSON.parse(found[0]) as { choice: string }).choice, usage };
  }
  return { status: "invalid", usage, detail: `Not a JSON choice: ${text.slice(0, 120) || "(empty)"}` };
}

function usageOf(inputTokens = 0, outputTokens = 0) {
  const c = config.llm;
  return { inputTokens, outputTokens, costUsd: cost(inputTokens, outputTokens, c.inputPricePerM, c.outputPricePerM) };
}
