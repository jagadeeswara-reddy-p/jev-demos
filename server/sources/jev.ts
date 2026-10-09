import { TASK, optionDescriptions, stateText } from "../../src/arena/prompt";
import type { DecisionSource } from "../../src/arena/types";
import { config } from "../config";
import { cost, httpError, liveSource } from "./live";

// Jev via the TypeSafe System One API: one Choice question whose options are
// the landing spots. Docs: https://docs.typesafe.ai/api.md
// Response: answers.placement = { choice, probabilities, confidence }.

interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export function jevSource(): DecisionSource {
  const c = config.jev;
  return liveSource(async (req, signal) => {
    const res = await fetch(`${c.baseUrl}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: c.model,
        state: stateText(req),
        questions: {
          placement: { type: "choice", instructions: TASK, criteria: optionDescriptions(req) },
        },
      }),
      signal,
    });
    if (!res.ok) return httpError("TypeSafe", res);

    const body = (await res.json()) as {
      answers?: { placement?: ChoiceAnswer };
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const inputTokens = body.usage?.input_tokens ?? 0;
    const outputTokens = body.usage?.output_tokens ?? 0;
    const usage = { inputTokens, outputTokens, costUsd: cost(inputTokens, outputTokens, c.inputPricePerM, c.outputPricePerM) };
    const answer = body.answers?.placement;
    if (!answer || typeof answer.choice !== "string") {
      return { status: "invalid", usage, detail: "The response had no placement choice" };
    }
    return {
      status: "ok",
      choice: answer.choice,
      probabilities: answer.probabilities,
      confidence: answer.confidence,
      usage,
    };
  }, c.timeoutMs);
}
