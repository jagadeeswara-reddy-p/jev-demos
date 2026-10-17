import type { ModelConfig } from "./types";

// Reachability of self-hosted models. A model with `healthCheck` set (Laya and
// Strands Decider point it at their `/health`) is pinged before the page lists
// models, before a run and before a Test move. A server that doesn't answer
// shows as unavailable, instead of every move waiting out the full timeout,
// which is what happens when a GPU box has deleted itself but `.env` still
// holds its address. Results are kept for a few seconds so a page load doesn't
// fan out into repeated pings.

interface Status {
  ok: boolean;
  at: number;
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
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(opts: HealthOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 10_000;
    this.timeoutMs = opts.timeoutMs ?? 2_000;
    this.now = opts.now ?? Date.now;
  }

  /** Pings every model that has a health check and no recent result, all at once. */
  async refresh(models: ModelConfig[]): Promise<void> {
    const due = models.filter((m) => m.healthCheck && !this.fresh(m.id));
    await Promise.all(due.map((m) => this.ping(m)));
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

  private fresh(id: string): boolean {
    const s = this.status.get(id);
    return Boolean(s && this.now() - s.at < this.ttlMs);
  }

  private async ping(model: ModelConfig): Promise<void> {
    const base = model.baseUrl ?? (model.url ? new URL(model.url).origin : "");
    const url = `${base}${model.healthCheck}`;
    let reason: string | undefined;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) reason = `${new URL(url).host} answered ${res.status} to its health check`;
    } catch {
      reason = `Not responding at ${new URL(url).host}. Is the server (or GPU box) running?`;
    }
    this.status.set(model.id, { ok: !reason, at: this.now(), reason });
  }
}
