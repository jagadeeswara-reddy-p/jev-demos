import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelStore, type StoreOptions } from "./store";

let dir: string;
let opts: StoreOptions;

const builtIn = {
  models: [
    { id: "jev", label: "Jev", adapter: "decision", baseUrl: "https://api.typesafe.ai", model: "jev-latest", apiKey: "${TYPESAFE_API_KEY}" },
    { id: "laya", label: "Laya", adapter: "decision", baseUrl: "${LAYA_BASE_URL}", model: "typed-decisions", apiKey: "${LAYA_API_KEY:-}" },
    { id: "gpt", label: "GPT", adapter: "bedrock", model: "us.openai.gpt" },
  ],
};
const custom = { label: "My Qwen", adapter: "completion", baseUrl: "http://localhost:8000/v1", model: "qwen", apiKey: "sk-local" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "models-"));
  writeFileSync(join(dir, "models.json"), JSON.stringify(builtIn));
  opts = {
    presetsPath: join(dir, "models.json"),
    localPath: join(dir, "models.local.json"),
    env: { TYPESAFE_API_KEY: "ts-key" },
    defaultLineup: ["jev", "random"],
    otherSources: ["random", "heuristic"],
  };
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ModelStore", () => {
  test("lists built-in models with availability, never their keys", () => {
    const store = new ModelStore(opts);
    const [jev, laya, gpt] = store.list();
    expect(jev).toMatchObject({ id: "jev", available: true, builtIn: true, kind: "system-one", settings: { hasKey: true } });
    expect(laya).toMatchObject({ available: false, reason: "Set LAYA_BASE_URL in .env", settings: { hasKey: false } });
    expect(gpt).toMatchObject({ available: false, reason: "Set AWS credentials in .env", kind: "llm" });
    expect(JSON.stringify(store.list())).not.toContain("ts-key");
    expect(jev.settings).not.toHaveProperty("apiKey");
  });

  test("resolves a model with its placeholders filled, or says why it can't run", () => {
    const store = new ModelStore(opts);
    expect(store.resolve("jev").apiKey).toBe("ts-key");
    expect(() => store.resolve("laya")).toThrow("Laya can't run: Set LAYA_BASE_URL in .env");
    expect(() => store.resolve("nope")).toThrow('Unknown model "nope"');
  });

  test("adds a model from the page, saves it with mode 600 and hides the key", () => {
    const store = new ModelStore(opts);
    const added = store.add(custom);
    expect(added).toMatchObject({ id: "my-qwen", builtIn: false, available: true, settings: { hasKey: true } });
    expect(JSON.stringify(added)).not.toContain("sk-local");
    expect(statSync(opts.localPath).mode & 0o777).toBe(0o600);
    expect(new ModelStore(opts).resolve("my-qwen").apiKey).toBe("sk-local");
  });

  test("gives page-added models free ids and refuses taken ones", () => {
    const store = new ModelStore(opts);
    expect(store.add(custom).id).toBe("my-qwen");
    expect(store.add(custom).id).toBe("my-qwen-2");
    expect(store.add({ ...custom, label: "Random" }).id).toBe("random-2");
    expect(() => store.add({ ...custom, id: "jev" })).toThrow('"jev" is already used');
  });

  test("page-added models can't use the bedrock adapter", () => {
    expect(() => new ModelStore(opts).add({ ...custom, adapter: "bedrock" })).toThrow("adapter:");
  });

  test("updates keep the saved key when none is typed", () => {
    const store = new ModelStore(opts);
    store.add(custom);
    store.update("my-qwen", { ...custom, apiKey: "", model: "qwen-2" });
    const m = new ModelStore(opts).resolve("my-qwen");
    expect(m.model).toBe("qwen-2");
    expect(m.apiKey).toBe("sk-local");
  });

  test("a saved key is never sent to a new address without being typed again", () => {
    const store = new ModelStore(opts);
    store.add(custom);
    expect(() => store.update("my-qwen", { ...custom, apiKey: "", baseUrl: "https://evil.example/v1" })).toThrow("type the key again");
    store.update("my-qwen", { ...custom, apiKey: "", baseUrl: "http://localhost:8000/v1/" });
    expect(new ModelStore(opts).resolve("my-qwen").apiKey).toBe("sk-local");
  });

  test("an address from .env that isn't a full URL makes the model unavailable, not broken", () => {
    const store = new ModelStore({ ...opts, env: { ...opts.env, LAYA_BASE_URL: "192.168.1.5:8000" } });
    expect(store.list().find((m) => m.id === "laya")).toMatchObject({
      available: false,
      reason: "LAYA_BASE_URL must be a full address such as http://10.0.0.5:8000",
    });
  });

  test("trailing slashes from .env are dropped before use", () => {
    const store = new ModelStore({ ...opts, env: { ...opts.env, LAYA_BASE_URL: "http://10.0.0.5:8000/" } });
    expect(store.resolve("laya").baseUrl).toBe("http://10.0.0.5:8000");
  });

  test("built-in models can't be changed or removed from the page", () => {
    const store = new ModelStore(opts);
    expect(() => store.update("jev", custom)).toThrow("built-in models are edited in models.json");
    expect(() => store.remove("jev")).toThrow("built-in models are removed in models.json");
  });

  test("the line-up defaults to LINEUP, is saved, and loses removed models", () => {
    const store = new ModelStore(opts);
    expect(store.lineup()).toEqual(["jev", "random"]);
    store.add(custom);
    expect(store.setLineup(["my-qwen", "jev", "heuristic"])).toEqual(["my-qwen", "jev", "heuristic"]);
    expect(new ModelStore(opts).lineup()).toEqual(["my-qwen", "jev", "heuristic"]);
    store.remove("my-qwen");
    expect(new ModelStore(opts).lineup()).toEqual(["jev", "heuristic"]);
  });

  test("checks a line-up before saving it", () => {
    const store = new ModelStore(opts);
    expect(() => store.setLineup([])).toThrow("pick 1 to 6 models");
    expect(() => store.setLineup(Array(7).fill("jev"))).toThrow("pick 1 to 6 models");
    expect(() => store.setLineup(["jev", "ghost"])).toThrow("unknown models: ghost");
    expect(() => store.setLineup("jev")).toThrow("must be a list");
    expect(existsSync(opts.localPath)).toBe(false);
  });

  test("ignores unknown ids in LINEUP rather than failing", () => {
    expect(new ModelStore({ ...opts, defaultLineup: ["ghost", "jev"] }).lineup()).toEqual(["jev"]);
  });

  test("reports a bad models file with its path and entry", () => {
    writeFileSync(opts.presetsPath, JSON.stringify({ models: [builtIn.models[0], { id: "x", adapter: "completion" }] }));
    expect(() => new ModelStore(opts)).toThrow(/models\.json, model 2: label: is required/);
  });

  test("refuses the same id twice across files and mocks", () => {
    writeFileSync(opts.presetsPath, JSON.stringify({ models: [{ ...builtIn.models[0], id: "random" }] }));
    expect(() => new ModelStore(opts)).toThrow('Model id "random" is used twice');
  });

  test("the local file is plain JSON a person can edit", () => {
    const store = new ModelStore(opts);
    store.add(custom);
    const file = JSON.parse(readFileSync(opts.localPath, "utf8"));
    expect(file.models[0]).toMatchObject({ id: "my-qwen", apiKey: "sk-local" });
  });
});

describe("models.json", () => {
  test("every built-in model is valid and ids are unique", () => {
    const store = new ModelStore({ ...opts, presetsPath: "models.json", env: {} });
    const ids = store.list().map((m) => m.id);
    expect(ids).toContain("live-jev");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
