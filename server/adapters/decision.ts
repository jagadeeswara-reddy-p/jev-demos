import { optionDescriptions, stateText, TASK } from "../../src/arena/prompt";
import type { DecisionAnswer, DecisionRequest } from "../../src/arena/types";
import type { ModelConfig } from "../models/types";
import { bearer, httpError, usageOf } from "./shared";
import type { Adapter } from "./types";

// Decision adapter: models that score a fixed set of options instead of writing
// text, over the Decisions API (TypeSafe's /v1/systemone). Jev, Laya's
// laya-serve, Cloudflare Clef and AWS Strands Decider all speak it.
//
//   POST {baseUrl}/v1/systemone   (or `url`)
//   { model, state, questions: { placement: { type: "choice", instructions, criteria } }, ...extraBody }
//   → { answers: { placement: { choice, probabilities, confidence } }, usage: { input_tokens, ... } }
//
// Cloudflare wraps the reply as { result: ... }; that is unwrapped here.
// With `rotations` > 1 the question is asked that many times with the option
// order shifted (each copy carries an `option_order`), and the probabilities
// are averaged, which cancels a preference for options listed early.

interface ChoiceAnswer {
  choice?: unknown;
  probabilities?: Record<string, number>;
  confidence?: number;
}

interface ReplyBody {
  answers?: Record<string, ChoiceAnswer | undefined>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    truncated?: boolean;
    state_tokens_dropped?: number;
    truncated_questions?: string[];
  };
}

/** Slot s of rotation r shows option (s + shift_r) mod k, with the shifts spread evenly. */
export function rotationOrders(optionCount: number, rotations: number): number[][] {
  const n = Math.max(1, Math.min(rotations, optionCount));
  return Array.from({ length: n }, (_, r) => {
    const shift = Math.round((r * optionCount) / n);
    return Array.from({ length: optionCount }, (_, s) => (s + shift) % optionCount);
  });
}

export function decisionBody(model: ModelConfig, req: DecisionRequest): Record<string, unknown> {
  const criteria = optionDescriptions(req);
  const question = { type: "choice", instructions: TASK, criteria };
  const rotations = model.rotations ?? 1;
  const questions =
    rotations <= 1
      ? { placement: question }
      : Object.fromEntries(
          rotationOrders(req.candidates.length, rotations).map((order, r) => [`placement_${r}`, { ...question, option_order: order }]),
        );
  return { model: model.model, state: stateText(req), questions, ...model.extraBody };
}

/** Reads the reply; several rotated answers are averaged into one. */
export function readDecision(model: ModelConfig, raw: ReplyBody & { result?: ReplyBody }): DecisionAnswer {
  const body: ReplyBody = raw.result ?? raw;
  const u = body.usage;
  const usage = usageOf(u?.input_tokens ?? u?.prompt_tokens ?? 0, u?.output_tokens ?? u?.completion_tokens ?? 0, model.prices);
  const truncated = u?.truncated || Boolean(u?.truncated_questions?.length);
  const detail = truncated
    ? `Input cut to fit the model's token budget (${u?.state_tokens_dropped ?? 0} state tokens dropped${u?.truncated_questions?.length ? ", option list cut" : ""})`
    : undefined;

  const answers = Object.entries(body.answers ?? {})
    .filter(([id]) => id === "placement" || id.startsWith("placement_"))
    .map(([, a]) => a)
    .filter((a): a is ChoiceAnswer => Boolean(a));
  if (answers.length === 0 || answers.some((a) => typeof a.choice !== "string")) {
    return { status: "invalid", usage, detail: "The response had no placement choice" };
  }
  if (answers.length === 1) {
    const [a] = answers;
    return { status: "ok", choice: a.choice as string, probabilities: a.probabilities, confidence: a.confidence, usage, detail };
  }
  if (answers.some((a) => !a.probabilities)) {
    return { status: "invalid", usage, detail: "Rotated answers need probabilities to be averaged" };
  }
  const probabilities: Record<string, number> = {};
  for (const a of answers) for (const [id, p] of Object.entries(a.probabilities!)) probabilities[id] = (probabilities[id] ?? 0) + p / answers.length;
  const entries = Object.entries(probabilities);
  if (entries.length === 0) return { status: "invalid", usage, detail: "The rotated answers had no probabilities" };
  const [choice, top] = entries.reduce((best, e) => (e[1] > best[1] ? e : best));
  return { status: "ok", choice, probabilities, confidence: top, usage, detail };
}

const warned = new Set<string>();

export const decisionAdapter: Adapter = {
  kind: "system-one",
  defaultTimeoutMs: 30_000,

  async decide(model, req, signal) {
    const res = await fetch(model.url ?? `${model.baseUrl}/v1/systemone`, {
      method: "POST",
      headers: { ...bearer(model.apiKey), "Content-Type": "application/json" },
      body: JSON.stringify(decisionBody(model, req)),
      signal,
    });
    if (!res.ok) return httpError(model.label, res);
    const answer = readDecision(model, await res.json());
    if (answer.detail?.startsWith("Input cut") && !warned.has(model.id)) {
      warned.add(model.id);
      console.warn(`${model.label}: ${answer.detail}. Raise its token budget in extraBody.`);
    }
    return answer;
  },
};
