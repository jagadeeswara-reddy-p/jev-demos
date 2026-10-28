import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FileSink } from "bun";
import { tetris } from "../src/arena/environment";
import { type ArenaEvent, DEFAULT_CONFIG, MAX_BOARDS, type RunConfig } from "../src/arena/types";
import type { Match } from "../src/core/types";
import { config } from "./config";
import { createSource, listSources } from "./sources";

// A live run on the server. The game clock is the server's wall clock at 1×,
// so a model's real response time is exactly the time it spends thinking in
// the game. Every event is appended to runs/<id>.jsonl and streamed to the
// browser over server-sent events; the file replays at any speed later.

const TICK_MS = 10;
const CLOCK_MS = 250;
const KEEP_FINISHED_MS = 10 * 60_000;

const encoder = new TextEncoder();
const runs = new Map<string, LiveRun>();

export class LiveRun {
  readonly events: ArenaEvent[] = [];
  finished = false;
  private sim: Match<ArenaEvent>;
  private clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private log: FileSink;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private lastWall = 0;

  constructor(
    readonly id: string,
    readonly config: RunConfig,
  ) {
    this.sim = tetris.createMatch(
      config,
      config.agents.map((spec) => createSource(config, spec)),
    );
    this.log = Bun.file(logPath(id)).writer();
  }

  start() {
    this.push(this.sim.start());
    this.lastWall = performance.now();
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.clockTimer = setInterval(() => this.send(`event: clock\ndata: ${JSON.stringify({ at: this.sim.t })}\n\n`), CLOCK_MS);
  }

  stop() {
    if (this.finished) return;
    this.push(this.sim.stop());
    this.end();
  }

  /**
   * A server-sent event stream: everything after `fromIndex`, then live events
   * until the run ends. Each event carries its index as the SSE id, so a browser
   * that reconnects (sending Last-Event-ID) resumes without duplicates.
   */
  stream(fromIndex = 0): Response {
    let self: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        self = controller;
        for (let i = fromIndex; i < this.events.length; i++) controller.enqueue(encoder.encode(frame(i, this.events[i])));
        if (this.finished) controller.close();
        else this.clients.add(controller);
      },
      cancel: () => {
        this.clients.delete(self);
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  }

  private tick() {
    const now = performance.now();
    // Real time, 1:1. The cap only matters if the process stalls badly.
    const dt = Math.min(now - this.lastWall, 250);
    this.lastWall = now;
    this.push(this.sim.step(dt));
    if (this.sim.finished) this.end();
  }

  private push(events: ArenaEvent[]) {
    for (const e of events) {
      this.events.push(e);
      this.log.write(`${JSON.stringify(e)}\n`);
      this.send(frame(this.events.length - 1, e));
    }
  }

  private send(chunk: string) {
    const bytes = encoder.encode(chunk);
    for (const c of this.clients) {
      try {
        c.enqueue(bytes);
      } catch {
        this.clients.delete(c);
      }
    }
  }

  private end() {
    this.finished = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    void this.log.end();
    for (const c of this.clients) {
      try {
        c.close();
      } catch {
        // already closed
      }
    }
    this.clients.clear();
    setTimeout(() => runs.delete(this.id), KEEP_FINISHED_MS);
  }
}

function frame(index: number, e: ArenaEvent): string {
  return `id: ${index}\ndata: ${JSON.stringify(e)}\n\n`;
}

/** Checks a run request from the browser and fills in the server's defaults. */
export function validateConfig(input: unknown): RunConfig {
  const body = (input ?? {}) as Partial<RunConfig>;
  const agents = Array.isArray(body.agents) ? body.agents : [];
  if (agents.length < 1 || agents.length > MAX_BOARDS) throw new Error(`A run needs between 1 and ${MAX_BOARDS} boards.`);
  const sources = new Map(listSources().map((s) => [s.id, s]));
  const ids = new Set<string>();
  for (const a of agents) {
    if (typeof a?.id !== "string" || typeof a?.name !== "string") throw new Error("Each board needs an id and a name.");
    if (ids.has(a.id)) throw new Error(`Board id "${a.id}" is used twice.`);
    ids.add(a.id);
    const s = sources.get(a.sourceId);
    if (!s) throw new Error(`Unknown source "${a.sourceId}".`);
    if (!s.available) throw new Error(`${s.label} isn't available: ${s.reason}.`);
  }
  const mode = body.mode === "frozen" ? "frozen" : "realtime";
  const seed = Number.isInteger(body.seed) && body.seed! >= 0 ? body.seed! : 1;
  const targetLines = Number.isInteger(body.targetLines) && body.targetLines! > 0 ? Math.min(body.targetLines!, 1000) : 0;
  return {
    ...DEFAULT_CONFIG,
    seed,
    mode,
    targetLines,
    agents: agents.map((a) => ({ id: a.id, name: a.name.slice(0, 40), kind: sources.get(a.sourceId)!.kind, sourceId: a.sourceId })),
  };
}

export function createRun(runConfig: RunConfig): LiveRun {
  mkdirSync(config.runsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
  // A random suffix keeps two runs started in the same millisecond apart.
  const id = `${stamp}-seed${runConfig.seed}-${crypto.randomUUID().slice(0, 4)}`;
  const run = new LiveRun(id, runConfig);
  runs.set(id, run);
  run.start();
  return run;
}

export function getRun(id: string): LiveRun | undefined {
  return runs.get(id);
}

export function isRunId(id: string): boolean {
  return /^[\w-]{1,80}$/.test(id);
}

export function logPath(id: string): string {
  return join(config.runsDir, `${id}.jsonl`);
}

export interface RunSummary {
  id: string;
  live: boolean;
  bytes: number;
  modifiedAt: string;
}

export function listRuns(): RunSummary[] {
  let files: string[] = [];
  try {
    files = readdirSync(config.runsDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  return files
    .map((f) => {
      const id = f.slice(0, -".jsonl".length);
      const st = statSync(join(config.runsDir, f));
      return { id, live: runs.get(id)?.finished === false, bytes: st.size, modifiedAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
