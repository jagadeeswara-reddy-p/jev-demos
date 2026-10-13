import index from "../index.html";
import { config } from "./config";
import { createRun, getRun, isRunId, listRuns, logPath, validateConfig } from "./runs";
import { modelRoutes } from "./routes/models";
import { listSources, models } from "./sources";

// One Bun process serves the React app (bundled from index.html, hot reloaded
// in development) and the arena API.
//
//   GET  /api/sources           decision sources and whether each is usable
//   /api/models, /api/lineup    configured models and the live line-up (server/routes/models.ts)
//   POST /api/runs              start a live run        body: RunConfig
//   GET  /api/runs              saved run logs, newest first
//   GET  /api/runs/:id/events   server-sent events for a run (catches up first)
//   GET  /api/runs/:id/log      the run as JSONL, for replay
//   POST /api/runs/:id/stop     stop a run

const server = Bun.serve({
  port: config.port,
  // Event streams stay open for minutes; the clock heartbeat keeps them busy.
  idleTimeout: 255,
  development: !config.production && { hmr: true, console: true },

  routes: {
    "/": index,

    "/api/health": () => Response.json({ ok: true }),

    "/api/sources": () => Response.json(listSources()),

    ...modelRoutes(models),

    "/api/runs": {
      GET: () => Response.json(listRuns()),
      POST: async (req) => {
        try {
          const run = createRun(validateConfig(await req.json()));
          return Response.json({ id: run.id, config: run.config }, { status: 201 });
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
        }
      },
    },

    "/api/runs/:id/events": (req) => {
      const run = getRun(req.params.id);
      if (!run) return Response.json({ error: "No live run with that id" }, { status: 404 });
      const header = req.headers.get("Last-Event-ID");
      const last = header === null ? NaN : Number(header);
      return run.stream(Number.isInteger(last) && last >= 0 ? last + 1 : 0);
    },

    "/api/runs/:id/log": async (req) => {
      const { id } = req.params;
      if (!isRunId(id)) return Response.json({ error: "Bad run id" }, { status: 400 });
      const file = Bun.file(logPath(id));
      if (!(await file.exists())) return Response.json({ error: "No saved run with that id" }, { status: 404 });
      return new Response(file, { headers: { "Content-Type": "application/x-ndjson" } });
    },

    "/api/runs/:id/stop": {
      POST: (req) => {
        const run = getRun(req.params.id);
        if (!run) return Response.json({ error: "No live run with that id" }, { status: 404 });
        run.stop();
        return Response.json({ ok: true });
      },
    },
  },

  fetch() {
    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

const live = listSources().filter((s) => s.live);
console.log(`Deadline Tetris on ${server.url}`);
console.log(`  Line-up  ${models.lineup().join(", ")}`);
for (const s of live) console.log(`  ${s.label.padEnd(18)} ${s.available ? "ready" : `off (${s.reason})`}`);
