import type { ModelInfo } from "../../server/models/types";
import type { TestResult } from "../../server/sample";

// The page's side of /api/models and /api/lineup (see server/routes/models.ts).

export type { ModelInfo, TestResult };

/** A rejected request; `field` names the setting the server objected to. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; field?: string };
  if (!res.ok) throw new ApiError(body.error ?? `The server returned ${res.status}`, body.field);
  return body;
}

export const listModels = () => call<ModelInfo[]>("/api/models");

/** Adds a model, or changes the page-added model `id`. */
export const saveModel = (settings: Record<string, unknown>, id?: string) =>
  call<ModelInfo>(id ? `/api/models/${encodeURIComponent(id)}` : "/api/models", { method: id ? "PUT" : "POST", body: JSON.stringify(settings) });

export const deleteModel = (id: string) => call<void>(`/api/models/${encodeURIComponent(id)}`, { method: "DELETE" });

export const testModel = (id: string) => call<TestResult>(`/api/models/${encodeURIComponent(id)}/test`, { method: "POST" });

export const saveLineup = (sources: string[]) =>
  call<{ sources: string[] }>("/api/lineup", { method: "PUT", body: JSON.stringify({ sources }) }).then((r) => r.sources);
