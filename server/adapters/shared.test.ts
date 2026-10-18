import { describe, expect, test } from "bun:test";
import type { DecisionAnswer } from "../../src/arena/types";
import { sampleRequest } from "../sample";
import { liveSource, parseChoice, redact, usageOf } from "./shared";

const usage = usageOf(0, 0);

describe("parseChoice", () => {
  test("reads plain and fenced JSON", () => {
    expect(parseChoice('{"choice":"option_1"}', usage).choice).toBe("option_1");
    expect(parseChoice('```\n{"choice": "option_9"}\n```', usage).choice).toBe("option_9");
  });

  test("takes the JSON out of a sentence only when there is exactly one", () => {
    expect(parseChoice('Sure: {"choice": "option_3"}.', usage).choice).toBe("option_3");
    expect(parseChoice('{"choice": "option_3"} or {"choice": "option_4"}', usage).status).toBe("invalid");
  });

  test("anything else is invalid, with the start of the text", () => {
    const a = parseChoice("option_3", usage);
    expect(a).toMatchObject({ status: "invalid", detail: "Not a JSON choice: option_3" });
  });
});

describe("redact", () => {
  test("masks credentials a provider echoes back in an error", () => {
    const text = redact('{"error":"bad key","authorization":"Bearer sk-test-000000000000","api_key":"xyz123","id":"AKIAIOSFODNN7EXAMPLE"}');
    expect(text).not.toContain("sk-test-000000000000");
    expect(text).not.toContain("xyz123");
    expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(text).toContain("bad key");
  });
});

describe("usageOf", () => {
  test("prices tokens per million, and is free without prices", () => {
    expect(usageOf(500_000, 100_000, { inputPerM: 1, outputPerM: 5 }).costUsd).toBeCloseTo(1);
    expect(usageOf(500_000, 100_000).costUsd).toBe(0);
  });
});

describe("liveSource", () => {
  const ask = (call: Parameters<typeof liveSource>[0], timeoutMs = 1000) =>
    new Promise<{ answer: DecisionAnswer; latencyMs?: number }>((resolve) =>
      liveSource(call, timeoutMs).request(sampleRequest(), (answer, _at, latencyMs) => resolve({ answer, latencyMs }), {
        now: () => 0,
        signal: new AbortController().signal,
      }),
    );

  test("delivers the answer with the measured latency", async () => {
    const { answer, latencyMs } = await ask(async () => {
      await Bun.sleep(20);
      return { status: "ok", choice: "option_1" };
    });
    expect(answer.choice).toBe("option_1");
    expect(latencyMs).toBeGreaterThanOrEqual(15);
  });

  test("a thrown error becomes an error answer", async () => {
    const { answer } = await ask(async () => {
      throw new Error("connection refused");
    });
    expect(answer).toEqual({ status: "error", detail: "connection refused" });
  });

  test("gives up after the timeout", async () => {
    const { answer } = await ask((_req, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))), 30);
    expect(answer).toEqual({ status: "error", detail: "No response within 30 ms" });
  });
});
