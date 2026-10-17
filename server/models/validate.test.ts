import { describe, expect, test } from "bun:test";
import { ModelError, slugify, validateModel } from "./validate";

const completion = { id: "my-model", label: "My model", adapter: "completion", baseUrl: "https://api.example.com/v1/", model: "m-1" };

function fieldOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ModelError) return err.field;
    throw err;
  }
  throw new Error("expected a ModelError");
}

describe("validateModel", () => {
  test("accepts a minimal model and cleans it up", () => {
    expect(validateModel({ ...completion, label: "  My model  ", apiKey: "", extraBody: {} })).toEqual({
      id: "my-model",
      label: "My model",
      adapter: "completion",
      baseUrl: "https://api.example.com/v1",
      model: "m-1",
    });
  });

  test("keeps adapter settings and prices", () => {
    const m = validateModel({ ...completion, jsonMode: "object", maxTokens: 512, prices: { inputPerM: 0.5 }, extraBody: { temperature: 0 } });
    expect(m.jsonMode).toBe("object");
    expect(m.maxTokens).toBe(512);
    expect(m.prices).toEqual({ inputPerM: 0.5, outputPerM: 0 });
    expect(m.extraBody).toEqual({ temperature: 0 });
  });

  test("names the field that is wrong", () => {
    expect(fieldOf(() => validateModel(null))).toBe("model");
    expect(fieldOf(() => validateModel({ ...completion, adapter: "grpc" }))).toBe("adapter");
    expect(fieldOf(() => validateModel({ ...completion, label: " " }))).toBe("label");
    expect(fieldOf(() => validateModel({ ...completion, model: 3 }))).toBe("model");
    expect(fieldOf(() => validateModel({ ...completion, id: "Has Spaces" }))).toBe("id");
    expect(fieldOf(() => validateModel({ ...completion, baseUrl: "" }))).toBe("baseUrl");
    expect(fieldOf(() => validateModel({ ...completion, baseUrl: "not a url" }))).toBe("baseUrl");
    expect(fieldOf(() => validateModel({ ...completion, baseUrl: "ftp://x.org" }))).toBe("baseUrl");
    expect(fieldOf(() => validateModel({ ...completion, timeoutMs: 10 }))).toBe("timeoutMs");
    expect(fieldOf(() => validateModel({ ...completion, prices: { inputPerM: -1 } }))).toBe("prices.inputPerM");
    expect(fieldOf(() => validateModel({ ...completion, prices: { cacheReadPerM: 1 } }))).toBe("prices.cacheReadPerM");
    expect(fieldOf(() => validateModel({ ...completion, extraBody: [] }))).toBe("extraBody");
    expect(fieldOf(() => validateModel({ ...completion, jsonMode: "xml" }))).toBe("jsonMode");
  });

  test("rejects settings of another adapter and unknown settings", () => {
    expect(() => validateModel({ ...completion, rotations: 4 })).toThrow("rotations: only applies to the decision adapter");
    expect(() => validateModel({ ...completion, temprature: 1 })).toThrow("temprature: is not a model setting");
  });

  test("takes a health check path, and only a path", () => {
    expect(validateModel({ ...completion, healthCheck: "/health" }).healthCheck).toBe("/health");
    expect(fieldOf(() => validateModel({ ...completion, healthCheck: "health" }))).toBe("healthCheck");
  });

  test("accepts a full url instead of a base url", () => {
    const m = validateModel({ ...completion, adapter: "decision", baseUrl: undefined, url: "https://x.org/run/clef", rotations: 4 });
    expect(m.url).toBe("https://x.org/run/clef");
    expect(m.rotations).toBe(4);
  });

  test("lets placeholders through for models.json", () => {
    const m = validateModel({ ...completion, baseUrl: "${LAYA_BASE_URL}", apiKey: "${KEY:-}" });
    expect(m.baseUrl).toBe("${LAYA_BASE_URL}");
  });

  test("offers bedrock only when allowed", () => {
    const bedrock = {
      id: "b",
      label: "B",
      adapter: "bedrock",
      model: "us.openai.gpt",
      toolChoice: "auto",
      prices: { inputPerM: 1, cacheReadPerM: 0.1 },
    };
    expect(fieldOf(() => validateModel(bedrock))).toBe("adapter");
    const m = validateModel(bedrock, { allowBedrock: true });
    expect(m.toolChoice).toBe("auto");
    expect(m.prices).toEqual({ inputPerM: 1, outputPerM: 0, cacheReadPerM: 0.1 });
  });
});

describe("slugify", () => {
  test("turns a label into an id", () => {
    expect(slugify("My Qwen 3 (vLLM)")).toBe("my-qwen-3-vllm");
    expect(slugify("  --  ")).toBe("model");
    expect(slugify("x".repeat(60)).length).toBeLessThanOrEqual(34);
  });
});
