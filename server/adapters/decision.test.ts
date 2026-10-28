import { afterAll, describe, expect, test } from "bun:test";
import type { ModelConfig } from "../models/types";
import { sampleTurn } from "../sample";
import { decisionAdapter, decisionBody, readDecision, rotationOrders } from "./decision";

const req = sampleTurn();
const base: ModelConfig = { id: "d", label: "Fake decisions", adapter: "decision", model: "fake", prices: { inputPerM: 1, outputPerM: 0 } };

// A Decisions API that records what it was sent and answers with whatever the test sets.
let reply: { status?: number; body: unknown } = { body: {} };
const seen: { path: string; auth: string | null; body: any }[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(r) {
    seen.push({ path: new URL(r.url).pathname, auth: r.headers.get("authorization"), body: await r.json() });
    return Response.json(reply.body, { status: reply.status ?? 200 });
  },
});
afterAll(() => server.stop(true));
const model = (extra: Partial<ModelConfig> = {}): ModelConfig => ({ ...base, baseUrl: `http://localhost:${server.port}`, ...extra });
const signal = () => new AbortController().signal;

describe("decisionBody", () => {
  test("asks one choice question whose options are the turn's options", () => {
    const body = decisionBody(base, req) as any;
    expect(body.model).toBe("fake");
    expect(typeof body.state).toBe("string");
    expect(Object.keys(body.questions)).toEqual(["choice"]);
    expect(body.questions.choice.type).toBe("choice");
    expect(Object.keys(body.questions.choice.criteria)).toEqual(req.action.options.map((c) => c.id));
  });

  test("adds extraBody fields", () => {
    expect(decisionBody({ ...base, extraBody: { max_len: 4096 } }, req)).toMatchObject({ max_len: 4096 });
  });

  test("asks rotated copies when rotations are on", () => {
    const body = decisionBody({ ...base, rotations: 4 }, req) as any;
    expect(Object.keys(body.questions)).toEqual(["choice_0", "choice_1", "choice_2", "choice_3"]);
    expect(body.questions.choice_0.option_order[0]).toBe(0);
    expect(body.questions.choice_1.option_order).toHaveLength(req.action.options.length);
  });
});

describe("rotationOrders", () => {
  test("each order is a permutation, shifted evenly", () => {
    const orders = rotationOrders(8, 4);
    expect(orders.map((o) => o[0])).toEqual([0, 2, 4, 6]);
    for (const o of orders) expect([...o].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test("with as many rotations as options, every option visits every slot once", () => {
    const orders = rotationOrders(5, 5);
    for (let slot = 0; slot < 5; slot++) expect(new Set(orders.map((o) => o[slot])).size).toBe(5);
  });

  test("never asks more copies than there are options", () => {
    expect(rotationOrders(3, 10)).toHaveLength(3);
    expect(rotationOrders(3, 0)).toHaveLength(1);
  });
});

describe("readDecision", () => {
  test("reads one answer with its probabilities and prices the tokens", () => {
    const a = readDecision(base, {
      answers: { choice: { choice: "option_2", probabilities: { option_1: 0.3, option_2: 0.7 }, confidence: 0.4 } },
      usage: { input_tokens: 2000, output_tokens: 10 },
    });
    expect(a).toMatchObject({ status: "ok", choice: "option_2", confidence: 0.4, usage: { inputTokens: 2000, outputTokens: 10, costUsd: 0.002 } });
  });

  test("unwraps Cloudflare's { result } envelope and its token names", () => {
    const a = readDecision(base, { result: { answers: { choice: { choice: "option_1" } }, usage: { prompt_tokens: 5 } } } as any);
    expect(a).toMatchObject({ status: "ok", choice: "option_1", usage: { inputTokens: 5 } });
  });

  test("averages rotated answers and picks the highest average", () => {
    const a = readDecision(base, {
      answers: {
        choice_0: { choice: "option_1", probabilities: { option_1: 0.6, option_2: 0.4 } },
        choice_1: { choice: "option_2", probabilities: { option_1: 0.2, option_2: 0.8 } },
      },
    });
    expect(a.choice).toBe("option_2");
    expect(a.probabilities!.option_1).toBeCloseTo(0.4);
    expect(a.confidence).toBeCloseTo(0.6);
  });

  test("says when the input was cut to fit", () => {
    const a = readDecision(base, { answers: { choice: { choice: "option_1" } }, usage: { truncated: true, state_tokens_dropped: 12 } });
    expect(a.detail).toContain("12 state tokens dropped");
  });

  test("rotated answers with empty probabilities are invalid, not a crash", () => {
    const a = readDecision(base, {
      answers: { choice_0: { choice: "option_1", probabilities: {} }, choice_1: { choice: "option_2", probabilities: {} } },
    });
    expect(a).toMatchObject({ status: "invalid", detail: "The rotated answers had no probabilities" });
  });

  test("an answer without a choice is invalid", () => {
    expect(readDecision(base, { answers: {} }).status).toBe("invalid");
    expect(readDecision(base, { answers: { choice: { choice: 3 } } }).status).toBe("invalid");
    expect(readDecision(base, { answers: { choice_0: { choice: "option_1" }, choice_1: { choice: "option_1" } } }).status).toBe("invalid");
  });
});

describe("decisionAdapter.decide", () => {
  test("posts to /v1/systemone with the key as a bearer token", async () => {
    reply = { body: { answers: { choice: { choice: "option_3" } } } };
    const a = await decisionAdapter.decide(model({ apiKey: "k-1" }), req, signal());
    expect(a.choice).toBe("option_3");
    expect(seen.at(-1)).toMatchObject({ path: "/v1/systemone", auth: "Bearer k-1" });
  });

  test("uses the full url when given, and sends no auth header without a key", async () => {
    reply = { body: { result: { answers: { choice: { choice: "option_1" } } } } };
    await decisionAdapter.decide(model({ baseUrl: undefined, url: `http://localhost:${server.port}/accounts/1/run/clef` }), req, signal());
    expect(seen.at(-1)).toMatchObject({ path: "/accounts/1/run/clef", auth: null });
  });

  test("turns an HTTP error into an error answer naming the model", async () => {
    reply = { status: 422, body: { error: "bad question" } };
    const a = await decisionAdapter.decide(model(), req, signal());
    expect(a.status).toBe("error");
    expect(a.detail).toStartWith("Fake decisions returned 422");
  });
});
