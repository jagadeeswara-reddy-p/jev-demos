import type { ModelConfig } from "./types";

// Reachability of self-hosted models. A model with `healthCheck` set (Laya and
// Strands Decider point it at their `/health`) is pinged before the page lists
// models, before a run and before a Test move. A server that doesn't answer
// shows as unavailable, instead of every move waiting out the full timeout,
// which is what happens when a GPU box has deleted itself but `.env` still
// holds its address. Results are kept for a few seconds, and a ping already in
// flight is shared, so a page load doesn't fan out into repeated pings.

interface Status {
  ok: boolean;
  at: number;
  /** The address pinged: a result for another address (the model was edited) doesn't count. */
  url: string;
  reason?: string;
}

export interface HealthOptions {
  /** How long a result is reused. */
  ttlMs?: number;
  /** How long a ping may take before the server counts as not responding. */
  timeoutMs?: number;
  now?: () => number;
}

export class HealthChecks {
  private status = new Map<string, Status>();
  private inFlight = new Map<string, Promise<void>>();
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(opts: HealthOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 10_000;
    this.timeoutMs = opts.timeoutMs ?? 2_000;
    this.now = opts.now ?? Date.now;
  }

  /** Pings every model that has a health check and no recent result, all at once. Never throws. */
  async refresh(models: ModelConfig[]): Promise<void> {
    const checked = new Set<string>();
    const pings: Promise<void>[] = [];
    for (const m of models) {
      const url = healthUrl(m);
      if (!url) continue;
      checked.add(m.id);
      const s = this.status.get(m.id);
      if (s && s.url === url && this.now() - s.at < this.ttlMs) continue;
      let p = this.inFlight.get(m.id);
      if (!p) {
        p = this.ping(m.id, url).finally(() => this.inFlight.delete(m.id));
        this.inFlight.set(m.id, p);
      }
      pings.push(p);
    }
    // A model that lost its health check, or can no longer run, drops its old result.
    for (const id of this.status.keys()) if (!checked.has(id)) this.status.delete(id);
    await Promise.all(pings);
  }

  /** Marks a model unavailable if its last ping failed; leaves everything else as it is. */
  apply<T extends { id: string; available: boolean; reason?: string }>(info: T): T {
    const s = this.status.get(info.id);
    if (!info.available || !s || s.ok) return info;
    return { ...info, available: false, reason: s.reason };
  }

  /** Why the model can't be reached, or undefined when it can (or isn't checked). */
  problem(id: string): string | undefined {
    const s = this.status.get(id);
    return s && !s.ok ? s.reason : undefined;
  }

  private async ping(id: string, url: string): Promise<void> {
    const host = hostOf(url);
    let reason: string | undefined;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) reason = `${host} answered ${res.status} to its health check`;
    } catch {
      reason = `Not responding at ${host}. Is the server (or GPU box) running?`;
    }
    this.status.set(id, { ok: !reason, at: this.now(), url, reason });
  }
}

/** The address to ping, or undefined when the model has no health check. */
function healthUrl(m: ModelConfig): string | undefined {
  if (!m.healthCheck) return undefined;
  let base = m.baseUrl ?? "";
  if (!base && m.url) {
    try {
      base = new URL(m.url).origin;
    } catch {
      base = m.url;
    }
  }
  return `${base.replace(/\/+$/, "")}${m.healthCheck}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
