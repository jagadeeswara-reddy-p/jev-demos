import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelStore } from "../models/store";
import type { ModelConfig } from "../models/types";
import type { TestResult } from "../sample";
import { modelRoutes } from "./models";

let dir: string;
let routes: ReturnType<typeof modelRoutes>;
let tested: ModelConfig[];

const custom = { label: "Local Qwen", adapter: "completion", baseUrl: "http://localhost:8000/v1", model: "qwen", apiKey: "sk-secret" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "routes-"));
  writeFileSync(
    join(dir, "models.json"),
    JSON.stringify({ models: [{ id: "laya", label: "Laya", adapter: "decision", baseUrl: "${LAYA_BASE_URL}", model: "typed-decisions" }] }),
  );
  const store = new ModelStore({
    presetsPath: join(dir, "models.json"),
    localPath: join(dir, "models.local.json"),
    env: {},
    defaultLineup: ["random"],
    otherSources: ["random"],
  });
  tested = [];
  const fakeTest = async (m: ModelConfig): Promise<TestResult> => {
    tested.push(m);
    return { status: "ok", choice: "option_1", latencyMs: 5, options: 34 };
  };
  routes = modelRoutes(store, fakeTest);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const json = (method: string, body?: unknown, params: Record<string, string> = {}) =>
  Object.assign(
    new Request("http://x/api", { method, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }),
    { params },
  );

describe("model routes", () => {
  test("add, list, change and remove a model; the key never comes back", async () => {
    const created = await routes["/api/models"].POST(json("POST", custom));
    expect(created.status).toBe(201);
    const text = await created.text();
    expect(text).not.toContain("sk-secret");
    expect(JSON.parse(text)).toMatchObject({ id: "local-qwen", settings: { hasKey: true } });

    const list = await (await routes["/api/models"].GET()).json();
    expect(list.map((m: { id: string }) => m.id)).toEqual(["laya", "local-qwen"]);

    const changed = await routes["/api/models/:id"].PUT(json("PUT", { ...custom, apiKey: "", model: "qwen-2" }, { id: "local-qwen" }));
    expect((await changed.json()).settings.model).toBe("qwen-2");

    expect((await routes["/api/models/:id"].DELETE(json("DELETE", undefined, { id: "local-qwen" }))).status).toBe(204);
    expect(await (await routes["/api/models"].GET()).json()).toHaveLength(1);
  });

  test("bad input is a 400 naming the field", async () => {
    const res = await routes["/api/models"].POST(json("POST", { ...custom, baseUrl: "nope" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "baseUrl" });
    const notJson = await routes["/api/models"].POST(json("POST", "{"));
    expect(await notJson.json()).toMatchObject({ field: "body" });
  });

  test("built-in models can't be changed from the page", async () => {
    const res = await routes["/api/models/:id"].DELETE(json("DELETE", undefined, { id: "laya" }));
    expect(res.status).toBe(400);
  });

  test("test runs one decision with the resolved model", async () => {
    await routes["/api/models"].POST(json("POST", custom));
    const res = await routes["/api/models/:id/test"].POST(json("POST", undefined, { id: "local-qwen" }));
    expect(await res.json()).toMatchObject({ status: "ok", choice: "option_1", latencyMs: 5 });
    expect(tested[0].apiKey).toBe("sk-secret");
  });

  test("testing a model that can't run is a 409, an unknown one a 404", async () => {
    const blocked = await routes["/api/models/:id/test"].POST(json("POST", undefined, { id: "laya" }));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toContain("Set LAYA_BASE_URL");
    expect((await routes["/api/models/:id/test"].POST(json("POST", undefined, { id: "ghost" }))).status).toBe(404);
  });

  test("the line-up can be read and saved", async () => {
    expect(await (await routes["/api/lineup"].GET()).json()).toEqual({ sources: ["random"] });
    await routes["/api/models"].POST(json("POST", custom));
    const saved = await routes["/api/lineup"].PUT(json("PUT", { sources: ["local-qwen", "random"] }));
    expect(await saved.json()).toEqual({ sources: ["local-qwen", "random"] });
    const bad = await routes["/api/lineup"].PUT(json("PUT", { sources: ["ghost"] }));
    expect(bad.status).toBe(400);
  });
});
