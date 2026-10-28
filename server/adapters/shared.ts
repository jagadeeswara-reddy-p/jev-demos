import { observationText } from "../../src/core/turn";
import type { Agent, Answer, Turn, Usage } from "../../src/core/types";
import type { Prices } from "../models/types";

// Pieces every adapter uses: timing a call as an Agent, reporting HTTP
// errors, pricing tokens, and the one prompt all chat models get.

/**
 * Wraps an HTTP call to a model as an Agent. Latency is measured on the
 * server's wall clock from just before the request to just after the response
 * is parsed, so it includes the network round trip, as a real game loop would see it.
 */
export function liveSource(call: (turn: Turn, signal: AbortSignal) => Promise<Answer>, timeoutMs: number): Agent {
  return {
    request(turn, deliver, ctx) {
      const started = performance.now();
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]);
      call(turn, signal)
        .then((answer) => deliver(answer, ctx.now(), performance.now() - started))
        .catch((err: unknown) => {
          if (ctx.signal.aborted) return; // the run was stopped; nobody is listening
          const timedOut = err instanceof DOMException && err.name === "TimeoutError";
          deliver(
            { status: "error", detail: timedOut ? `No response within ${timeoutMs} ms` : redact(errorText(err)) },
            ctx.now(),
            performance.now() - started,
          );
        });
    },
  };
}

export async function httpError(service: string, res: Response): Promise<Answer> {
  const body = await res.text().catch(() => "");
  return { status: "error", detail: `${service} returned ${res.status}: ${redact(body).slice(0, 200)}` };
}

/**
 * Masks anything shaped like a credential in text a provider sent back, since error
 * details are shown in the page and saved in run logs: some gateways echo the request.
 */
export function redact(text: string): string {
  return text
    .replace(/arn:aws:[^\s"',]+/gi, "arn:aws:[redacted]")
    .replace(/\b\d{12}\b/g, "[redacted]")
    .replace(/(bearer\s+)[^\s"',]+/gi, "$1[redacted]")
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, "$1-[redacted]")
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{12,}/g, "[redacted]")
    .replace(/("?(?:api[_-]?key|token|secret|password|authorization)"?\s*[:=]\s*"?)[^\s"',}]+/gi, "$1[redacted]");
}

export function usageOf(inputTokens: number, outputTokens: number, prices?: Prices): Usage {
  const costUsd = prices ? (inputTokens * prices.inputPerM + outputTokens * prices.outputPerM) / 1_000_000 : 0;
  return { inputTokens, outputTokens, costUsd };
}

export function bearer(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

// ---------- the chat prompt (completion and bedrock adapters) ----------

export function systemText(turn: Turn): string {
  return `${turn.instructions} Reply with JSON only, in the form {"choice": "<option id>"}.`;
}

export function userText(turn: Turn): string {
  const options = turn.action.options.map((o) => `${o.id}: ${o.text}`).join("\n");
  return `${observationText(turn)}\n\nOptions:\n${options}`;
}

/** JSON schema for the answer: one of the offered option ids. */
export function choiceSchema(turn: Turn) {
  return {
    type: "object",
    properties: { choice: { type: "string", enum: turn.action.options.map((o) => o.id) } },
    required: ["choice"],
    additionalProperties: false,
  };
}

/** Strict: the answer must be JSON naming an option. No guessing from free text. */
export function parseChoice(text: string, usage: Usage): Answer {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
