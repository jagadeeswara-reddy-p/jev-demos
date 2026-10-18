import type { ModelStore } from "../models/store";
import type { ModelConfig } from "../models/types";
import { ModelError } from "../models/validate";
import { type TestResult, testModel } from "../sample";

// The models panel's API. Keys go in (POST/PUT bodies) but never come back out.
//
//   GET    /api/models            every model, with whether it can run
//   POST   /api/models            add a model              body: model settings
//   PUT    /api/models/:id        change a page-added model
//   DELETE /api/models/:id        remove a page-added model
//   POST   /api/models/:id/test   one real decision: status, choice, latency
//   GET    /api/lineup            the live line-up         → { sources: [...] }
//   PUT    /api/lineup            save it                  body: { sources: [...] }

type Req = Request & { params: Record<string, string> };

/** Reachability of self-hosted models (server/models/health.ts); a no-op where none is given. */
export interface Health {
  /** Pings the models whose last result is stale. */
  refresh(): Promise<void>;
  /** Marks a model unavailable when its last ping failed. */
  apply<T extends { id: string; available: boolean; reason?: string }>(info: T): T;
  /** Why the model can't be reached, if it can't. */
  problem(id: string): string | undefined;
}

const NO_HEALTH: Health = { refresh: async () => {}, apply: (i) => i, problem: () => undefined };

export function modelRoutes(store: ModelStore, test: (m: ModelConfig) => Promise<TestResult> = testModel, health: Health = NO_HEALTH) {
  return {
    "/api/models": {
      GET: async () => {
        await health.refresh();
        return Response.json(store.list().map((m) => health.apply(m)));
      },
      POST: (req: Request) => guard(async () => Response.json(store.add(await body(req)), { status: 201 })),
    },
    "/api/models/:id": {
      PUT: (req: Req) => guard(async () => Response.json(store.update(req.params.id, await body(req)))),
      DELETE: (req: Req) =>
        guard(async () => {
          store.remove(req.params.id);
          return new Response(null, { status: 204 });
        }),
    },
    "/api/models/:id/test": {
      POST: (req: Req) =>
        guard(async () => {
          if (!store.has(req.params.id)) return Response.json({ error: `No model "${req.params.id}"` }, { status: 404 });
          const model = store.resolve(req.params.id);
          await health.refresh();
          const problem = health.problem(req.params.id);
          if (problem) return Response.json({ error: `${model.label} can't run: ${problem}` }, { status: 409 });
          return Response.json(await test(model));
        }),
    },
    "/api/lineup": {
      GET: () => Response.json({ sources: store.lineup() }),
      PUT: (req: Request) =>
        guard(async () => {
          const b = await body(req);
          return Response.json({ sources: store.setLineup((b as { sources?: unknown }).sources) });
        }),
    },
  };
}

async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ModelError("body", "must be JSON");
  }
}

/** Bad input is a 400 naming the field; a model that can't run is a 409; anything else a 500. */
async function guard(handle: () => Promise<Response>): Promise<Response> {
  try {
    return await handle();
  } catch (err) {
    if (err instanceof ModelError) return Response.json({ error: err.message, field: err.field }, { status: 400 });
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: message.includes("can't run") ? 409 : 500 });
  }
}
