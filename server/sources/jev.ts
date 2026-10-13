import { TASK, optionDescriptions, stateText } from "../../src/arena/prompt";
import type { DecisionSource } from "../../src/arena/types";
import { config } from "../config";
import { cost, httpError, liveSource } from "./live";

// System One models over the TypeSafe `/v1/systemone` wire protocol: one Choice
// question whose options are the landing spots. Jev is TypeSafe's hosted API
// (docs: https://docs.typesafe.ai/api.md); Laya's open-source `laya-serve`
// speaks the same protocol, and so does Cloudflare's Clef on Workers AI (at its own
// address, with the body wrapped in `{ result }`), so all three share this adapter
// and the same request.
// Response: answers.placement = { choice, probabilities, confidence }.

interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface SystemOneEndpoint {
  /** Named in error messages, e.g. "TypeSafe". */
  service: string;
  baseUrl: string;
  /** The full request address, when it isn't `${baseUrl}/v1/systemone` (Cloudflare). */
  url?: string;
  /** Sent as a bearer token when set (a local laya-serve usually has none). */
  apiKey: string;
  model: string;
  timeoutMs: number;
  inputPricePerM: number;
  outputPricePerM: number;
  /** Extra request fields, e.g. Laya's token budgets. */
  extraBody?: Record<string, unknown>;
}

const warnedTruncation = new Set<string>();

export function systemOneSource(c: SystemOneEndpoint): DecisionSource {
  return liveSource(async (req, signal) => {
    const res = await fetch(c.url ?? `${c.baseUrl}/v1/systemone`, {
      method: "POST",
      headers: { ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: c.model,
        state: stateText(req),
        questions: {
          placement: { type: "choice", instructions: TASK, criteria: optionDescriptions(req) },
        },
        ...c.extraBody,
      }),
      signal,
    });
    if (!res.ok) return httpError(c.service, res);

    type Body = {
      answers?: { placement?: ChoiceAnswer };
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        prompt_tokens?: number;
        completion_tokens?: number;
        truncated?: boolean;
        state_tokens_dropped?: number;
        truncated_questions?: string[];
      };
    };
    // Cloudflare wraps every response as { result, success, errors }.
    const raw = (await res.json()) as Body & { result?: Body };
    const body: Body = raw.result ?? raw;
    const inputTokens = body.usage?.input_tokens ?? body.usage?.prompt_tokens ?? 0;
    const outputTokens = body.usage?.output_tokens ?? body.usage?.completion_tokens ?? 0;
    const usage = { inputTokens, outputTokens, costUsd: cost(inputTokens, outputTokens, c.inputPricePerM, c.outputPricePerM) };
    // laya-serve says when part of the board or the option list didn't fit its token budget.
    const truncated = body.usage?.truncated || Boolean(body.usage?.truncated_questions?.length);
    const detail = truncated
      ? `Input cut to fit the model's token budget (${body.usage?.state_tokens_dropped ?? 0} state tokens dropped${body.usage?.truncated_questions?.length ? ", option list cut" : ""})`
      : undefined;
    if (detail && !warnedTruncation.has(c.baseUrl)) {
      warnedTruncation.add(c.baseUrl);
      console.warn(`${c.service}: ${detail}. Raise the token budget in .env.`);
    }
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
      detail,
    };
  }, c.timeoutMs);
}

export function jevSource(): DecisionSource {
  return systemOneSource({ service: "TypeSafe", ...config.jev });
}

export function clefSource(): DecisionSource {
  const c = config.clef;
  return systemOneSource({
    service: "Cloudflare",
    baseUrl: "https://api.cloudflare.com",
    url: `https://api.cloudflare.com/client/v4/accounts/${c.accountId}/ai/run/@cf/cloudflare/clef`,
    apiKey: c.apiToken,
    model: c.model,
    timeoutMs: c.timeoutMs,
    inputPricePerM: c.inputPricePerM,
    outputPricePerM: c.outputPricePerM,
  });
}

export function gemmaSource(): DecisionSource {
  return systemOneSource({ service: "EmbeddingGemma", ...config.gemma });
}

export function layaSource(): DecisionSource {
  const c = config.laya;
  return systemOneSource({
    service: "Laya",
    ...c,
    extraBody: { max_len: c.maxLen, head_max_len: c.headMaxLen },
  });
}
