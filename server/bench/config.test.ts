import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BenchConfigError, loadBench, parseBench } from "./config";

const EXAMPLE = join(import.meta.dir, "../../bench.example.yaml");

function fieldOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof BenchConfigError) return err.field;
    throw err;
  }
  throw new Error("expected a BenchConfigError");
}

describe("parseBench defaults", () => {
  test("fills in every default", () => {
    const c = parseBench({ name: "a", models: ["jev"] });
    expect(c.name).toBe("a");
    expect(c.environment).toBe("tetris");
    expect(c.seeds).toEqual([1, 2, 3, 4, 5]);
    expect(c.clocks).toEqual(["frozen", "realtime"]);
    expect(c.variants).toEqual(["described"]);
    expect(c.goal).toBe("survive");
    expect(c.maxDurationMs).toBe(600000);
    expect(c.maxPieces).toBe(1000);
    expect(c.stopWhenFinished).toBe(0.75);
    expect(c.maxCostUsd).toBeUndefined();
    expect(c.models).toEqual(["jev"]);
  });
});

describe("seeds", () => {
  test("a number n means 1..n", () => {
    expect(parseBench({ name: "a", seeds: 3, models: ["jev"] }).seeds).toEqual([1, 2, 3]);
  });

  test("a list is kept as given", () => {
    expect(parseBench({ name: "a", seeds: [7, 9], models: ["jev"] }).seeds).toEqual([7, 9]);
  });

  test("zero, duplicates and out-of-range values are refused", () => {
    expect(fieldOf(() => parseBench({ name: "a", seeds: 0, models: ["jev"] }))).toBe("seeds");
    expect(fieldOf(() => parseBench({ name: "a", seeds: 101, models: ["jev"] }))).toBe("seeds");
    expect(fieldOf(() => parseBench({ name: "a", seeds: [1, 1], models: ["jev"] }))).toBe("seeds");
    expect(fieldOf(() => parseBench({ name: "a", seeds: [-1], models: ["jev"] }))).toBe("seeds");
    expect(fieldOf(() => parseBench({ name: "a", seeds: [], models: ["jev"] }))).toBe("seeds");
  });
});

describe("clocks and variants", () => {
  test("clocks are normalised to frozen, realtime", () => {
    expect(parseBench({ name: "a", clocks: ["realtime", "frozen"], models: ["jev"] }).clocks).toEqual(["frozen", "realtime"]);
  });

  test("an empty or unknown clock set is refused", () => {
    expect(fieldOf(() => parseBench({ name: "a", clocks: [], models: ["jev"] }))).toBe("clocks");
    expect(fieldOf(() => parseBench({ name: "a", clocks: ["slow"], models: ["jev"] }))).toBe("clocks");
  });

  test("a variant the environment does not have is refused", () => {
    expect(fieldOf(() => parseBench({ name: "a", variants: ["board-only"], models: ["jev"] }))).toBe("variants");
  });

  test("a repeated variant is refused, since two matches would share a log file", () => {
    expect(fieldOf(() => parseBench({ name: "a", variants: ["described", "described"], models: ["jev"] }))).toBe("variants");
  });
});

describe("models", () => {
  test("an inline model with a literal key is refused", () => {
    expect(fieldOf(() => parseBench({ name: "a", models: [{ id: "x", apiKey: "sk-live-123" }] }))).toBe("models[0].apiKey");
  });

  test("an inline model with an env placeholder is kept as written", () => {
    const entry = { id: "x", apiKey: "${OPENROUTER_API_KEY}", prices: { inputPerM: 1 } };
    expect(parseBench({ name: "a", models: [entry] }).models).toEqual([entry]);
  });

  test("duplicate ids are refused at the later entry", () => {
    expect(fieldOf(() => parseBench({ name: "a", models: ["jev", "jev"] }))).toBe("models[1]");
  });

  test("thirteen models are refused", () => {
    const models = Array.from({ length: 13 }, (_, i) => `m${i}`);
    expect(fieldOf(() => parseBench({ name: "a", models }))).toBe("models");
  });

  test("an empty list is refused", () => {
    expect(fieldOf(() => parseBench({ name: "a", models: [] }))).toBe("models");
  });

  test("ids must match the id pattern", () => {
    expect(fieldOf(() => parseBench({ name: "a", models: ["Has Spaces"] }))).toBe("models[0]");
    expect(fieldOf(() => parseBench({ name: "a", models: [{ label: "no id" }] }))).toBe("models[0].id");
  });
});

describe("names and unknown keys", () => {
  test("name must match the id pattern", () => {
    expect(fieldOf(() => parseBench({ name: "Bad Name", models: ["jev"] }))).toBe("name");
    expect(fieldOf(() => parseBench({ models: ["jev"] }))).toBe("name");
  });

  test("environment, if present, must be tetris", () => {
    expect(fieldOf(() => parseBench({ name: "a", environment: "chess", models: ["jev"] }))).toBe("environment");
  });

  test("unknown top-level keys are refused", () => {
    expect(fieldOf(() => parseBench({ name: "a", concurrency: 2, models: ["jev"] }))).toBe("concurrency");
  });

  test("unknown keys inside tetris and limits are refused", () => {
    expect(fieldOf(() => parseBench({ name: "a", tetris: { speed: 2 }, models: ["jev"] }))).toBe("tetris.speed");
    expect(fieldOf(() => parseBench({ name: "a", limits: { retries: 1 }, models: ["jev"] }))).toBe("limits.retries");
  });
});

describe("limits and tetris settings", () => {
  test("maxDurationMs, maxPieces and goal are checked", () => {
    expect(fieldOf(() => parseBench({ name: "a", tetris: { maxDurationMs: 9999 }, models: ["jev"] }))).toBe("tetris.maxDurationMs");
    expect(fieldOf(() => parseBench({ name: "a", tetris: { maxDurationMs: 3600001 }, models: ["jev"] }))).toBe("tetris.maxDurationMs");
    expect(fieldOf(() => parseBench({ name: "a", tetris: { maxPieces: 0 }, models: ["jev"] }))).toBe("tetris.maxPieces");
    expect(fieldOf(() => parseBench({ name: "a", tetris: { goal: "clear" }, models: ["jev"] }))).toBe("tetris.goal");
    const c = parseBench({ name: "a", tetris: { goal: "sprint40", maxDurationMs: 10000, maxPieces: 10000 }, models: ["jev"] });
    expect([c.goal, c.maxDurationMs, c.maxPieces]).toEqual(["sprint40", 10000, 10000]);
  });

  test("stopWhenFinished must be in (0, 1]", () => {
    expect(fieldOf(() => parseBench({ name: "a", limits: { stopWhenFinished: 0 }, models: ["jev"] }))).toBe("limits.stopWhenFinished");
    expect(fieldOf(() => parseBench({ name: "a", limits: { stopWhenFinished: 1.5 }, models: ["jev"] }))).toBe("limits.stopWhenFinished");
    expect(parseBench({ name: "a", limits: { stopWhenFinished: 1 }, models: ["jev"] }).stopWhenFinished).toBe(1);
  });

  test("maxCostUsd must be greater than 0", () => {
    expect(fieldOf(() => parseBench({ name: "a", limits: { maxCostUsd: 0 }, models: ["jev"] }))).toBe("limits.maxCostUsd");
    expect(parseBench({ name: "a", limits: { maxCostUsd: 5 }, models: ["jev"] }).maxCostUsd).toBe(5);
  });
});

function parseFailure(field: string): string {
  return new BenchConfigError(field, "must be an ${ENV} placeholder; put the key itself in .env").message;
}

describe("loadBench", () => {
  test("parses the example file", async () => {
    const c = await loadBench(EXAMPLE);
    expect(c.name).toBe("my-first-bench");
    expect(c.models).toHaveLength(3);
  });

  test("a JSON file with the same content gives the same config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-"));
    const json = join(dir, "bench.json");
    const raw = Bun.YAML.parse(readFileSync(EXAMPLE, "utf8"));
    writeFileSync(json, JSON.stringify(raw));
    expect(await loadBench(json)).toEqual(await loadBench(EXAMPLE));
  });

  test("a validation failure keeps its class and field", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-"));
    const bad = join(dir, "bench.yaml");
    writeFileSync(bad, "name: a\nmodels:\n  - id: x\n    apiKey: sk-live-123\n");
    const err = await loadBench(bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BenchConfigError);
    expect((err as BenchConfigError).field).toBe("models[0].apiKey");
    expect((err as BenchConfigError).message).toBe(parseFailure("models[0].apiKey"));
  });

  test("a YAML syntax error is a BenchConfigError whose field is the path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-"));
    const bad = join(dir, "bench.yaml");
    writeFileSync(bad, "name: [unclosed\n");
    const err = await loadBench(bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BenchConfigError);
    expect((err as BenchConfigError).field).toBe(bad);
    expect((err as BenchConfigError).message.startsWith(`${bad}: `)).toBe(true);
  });

  test("a JSON syntax error is a BenchConfigError whose field is the path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-"));
    const bad = join(dir, "bench.json");
    writeFileSync(bad, "{ not json");
    const err = await loadBench(bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BenchConfigError);
    expect((err as BenchConfigError).field).toBe(bad);
  });

  test("a missing file is a BenchConfigError whose field is the path", async () => {
    const missing = join(mkdtempSync(join(tmpdir(), "bench-")), "nope.yaml");
    const err = await loadBench(missing).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BenchConfigError);
    expect((err as BenchConfigError).field).toBe(missing);
  });
});
