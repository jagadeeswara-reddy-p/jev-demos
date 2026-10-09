import type { ArenaBackend, ArenaEvent, RunConfig, SourceInfo } from "./types";

// Runs on the Bun server, which holds the API keys and calls the real models.
// Live runs play at 1×: a model's real response time is its thinking time in
// the game, so there is nothing to pause or speed up. Replays fast-forward.
export class ServerBackend implements ArenaBackend {
  private listeners = new Set<(e: ArenaEvent) => void>();
  private runId: string | null = null;
  private clock = { at: 0, wall: 0 };
  private finishedAt: number | null = null;

  constructor(private onError: (message: string) => void) {}

  subscribe(listener: (e: ArenaEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(config: RunConfig) {
    void this.open(config);
  }

  pause() {}
  resume() {}
  setSpeed() {}

  stop() {
    if (this.runId) void fetch(`/api/runs/${this.runId}/stop`, { method: "POST" });
  }

  /** Server time, interpolated between clock heartbeats so timers move smoothly. */
  now() {
    if (this.finishedAt !== null) return this.finishedAt;
    if (this.clock.wall === 0) return 0;
    return this.clock.at + Math.min(performance.now() - this.clock.wall, 1000);
  }

  private async open(config: RunConfig) {
    let res: Response;
    try {
      res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
    } catch {
      this.onError("Couldn't reach the server. Is `bun dev` running?");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !body.id) {
      this.onError(body.error ?? `The server refused the run (${res.status}).`);
      return;
    }
    this.runId = body.id;
    const source = new EventSource(`/api/runs/${body.id}/events`);
    source.onmessage = (m) => {
      const e = JSON.parse(m.data) as ArenaEvent;
      this.sync(e.at);
      if (e.t === "run_finished") {
        this.finishedAt = e.at;
        source.close();
      }
      for (const l of this.listeners) l(e);
    };
    source.addEventListener("clock", (m) => this.sync((JSON.parse((m as MessageEvent).data) as { at: number }).at));
    source.onerror = () => {
      // EventSource reconnects on its own; only report it if it gave up.
      if (this.finishedAt === null && source.readyState === EventSource.CLOSED) {
        this.onError("Lost the connection to the server.");
      }
    };
  }

  private sync(at: number) {
    if (at >= this.clock.at) this.clock = { at, wall: performance.now() };
  }
}

export async function fetchSources(): Promise<SourceInfo[] | null> {
  try {
    const res = await fetch("/api/sources");
    return res.ok ? ((await res.json()) as SourceInfo[]) : null;
  } catch {
    return null;
  }
}
