import { describe, expect, test } from "bun:test";
import type { AgentSpec, RunConfig, SourceInfo, TetrisAgent } from "../../src/arena/types";
import { BenchConfigError } from "./config";
import { agentFor, resolveEntrants } from "./entrants";

const sources: SourceInfo[] = [
  { id: "live-x", label: "Live X", kind: "llm", description: "", live: true, available: true },
  { id: "live-y", label: "Live Y", kind: "llm", description: "", live: true, available: false, reason: "Set Y in .env" },
  { id: "heuristic", label: "Heuristic", kind: "baseline", description: "", live: false, available: true },
];

const inline = {
  id: "my-model",
  label: "My Model",
  adapter: "completion",
  model: "m-1",
  baseUrl: "https://x.test/v1",
  apiKey: "${K}",
};

function fieldOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof BenchConfigError) return err.field;
    throw err;
  }
  throw new Error("expected a BenchConfigError");
}

describe("resolveEntrants: model ids", () => {
  test("takes label, kind and live from the source", () => {
    const [e] = resolveEntrants(["heuristic"], sources, {});
    expect(e).toEqual({ id: "heuristic", label: "Heuristic", kind: "baseline", live: false });
    expect(e.model).toBeUndefined();
    expect(e.unavailable).toBeUndefined();
  });

  test("an unavailable source gives its reason", () => {
    const [e] = resolveEntrants(["live-y"], sources, {});
    expect(e.live).toBe(true);
    expect(e.unavailable).toBe("Set Y in .env");
  });

  test("an unknown id throws, naming the known ids", () => {
    expect(fieldOf(() => resolveEntrants(["nope"], sources, {}))).toBe("models[0]");
    expect(() => resolveEntrants(["nope"], sources, {})).toThrow(/heuristic/);
  });
});

describe("resolveEntrants: inline models", () => {
  test("a missing variable makes it unavailable, without a model", () => {
    const [e] = resolveEntrants([inline], sources, {});
    expect(e.id).toBe("my-model");
    expect(e.label).toBe("My Model");
    expect(e.kind).toBe("llm");
    expect(e.live).toBe(true);
    expect(e.unavailable).toBe("Set K in .env");
    expect(e.model).toBeUndefined();
  });

  test("with the variable set, the placeholders are filled and the model is kept", () => {
    const [e] = resolveEntrants([inline], sources, { K: "k" });
    expect(e.model?.apiKey).toBe("k");
    expect(e.model?.baseUrl).toBe("https://x.test/v1");
    expect(e.live).toBe(true);
    expect(e.kind).toBe("llm");
    expect(e.unavailable).toBeUndefined();
  });

  test("an unknown adapter throws at models[i].adapter", () => {
    const bad = { ...inline, adapter: "teleport" };
    expect(fieldOf(() => resolveEntrants([bad], sources, { K: "k" }))).toBe("models[0].adapter");
  });
});

describe("agentFor", () => {
  const run = {} as RunConfig;
  const spec: AgentSpec = { id: "a", name: "A", kind: "llm", sourceId: "heuristic" };
  const fake = {} as TetrisAgent;

  test("a model id uses the fallback", () => {
    const calls: [RunConfig, AgentSpec][] = [];
    const [e] = resolveEntrants(["heuristic"], sources, {});
    const agent = agentFor(e, run, spec, (r, s) => {
      calls.push([r, s]);
      return fake;
    });
    expect(agent).toBe(fake);
    expect(calls).toEqual([[run, spec]]);
  });

  test("an inline model does not use the fallback", () => {
    let called = false;
    const [e] = resolveEntrants([inline], sources, { K: "k" });
    const agent = agentFor(e, run, spec, () => {
      called = true;
      return fake;
    });
    expect(called).toBe(false);
    expect(agent).not.toBe(fake);
  });
});
