import type { DecisionAnswer, DecisionRequest, DecisionSource } from "../../src/arena/types";

/**
 * Wraps an HTTP call to a model as a DecisionSource. Latency is measured on the
 * server's wall clock from just before the request to just after the response
 * is parsed, so it includes the network round trip, as a real game loop would see it.
 */
export function liveSource(
  call: (req: DecisionRequest, signal: AbortSignal) => Promise<DecisionAnswer>,
  timeoutMs: number,
): DecisionSource {
  return {
    request(req, deliver, ctx) {
      const started = performance.now();
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]);
      call(req, signal)
        .then((answer) => deliver(answer, ctx.now(), performance.now() - started))
        .catch((err: unknown) => {
          if (ctx.signal.aborted) return; // the run was stopped; nobody is listening
          const timedOut = err instanceof DOMException && err.name === "TimeoutError";
          deliver(
            { status: "error", detail: timedOut ? `No response within ${timeoutMs} ms` : errorText(err) },
            ctx.now(),
            performance.now() - started,
          );
        });
    },
  };
}

export async function httpError(service: string, res: Response): Promise<DecisionAnswer> {
  const body = await res.text().catch(() => "");
  return { status: "error", detail: `${service} returned ${res.status}: ${body.slice(0, 200)}` };
}

export function cost(inputTokens: number, outputTokens: number, inPerM: number, outPerM: number): number {
  return (inputTokens * inPerM + outputTokens * outPerM) / 1_000_000;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
