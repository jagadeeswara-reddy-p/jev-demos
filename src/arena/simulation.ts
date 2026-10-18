import { type Board, encodeBoard } from "../engine/board";
import { type Candidate, gravityMsPerRow, type LockResult, MAX_LEVEL, TetrisGame } from "../engine/game";
import { evaluatePlacement } from "../engine/heuristic";
import type { PieceType } from "../engine/pieces";
import { deriveSeed } from "../engine/rng";
import type { AgentSpec, ArenaEvent, DecisionAnswer, DecisionSource, DecisionStatus, DecisionUsage, RunConfig } from "./types";

// One arena run on simulated time. The game rules are deterministic; where the
// answers come from is up to each board's DecisionSource. Mock sources answer
// in simulated time (fully reproducible); live sources call a real API and
// deliver whenever the response comes back. The browser MockBackend and the
// Bun server both drive this class; tests drive it directly.

const SUBSTEP_MS = 4;

interface PendingDecision {
  pieceId: number;
  requestedAt: number;
  arrivesAt: number;
  latencyMs: number;
  status: Extract<DecisionStatus, "ok" | "invalid" | "error">;
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  usage?: DecisionUsage;
  detail?: string;
  /** Heuristic rank of every option offered for this piece, to grade the answer. */
  ranks: Map<string, number>;
}

interface Player {
  spec: AgentSpec;
  source: DecisionSource;
  game: TetrisGame;
  candidates: Candidate[];
  requestedAt: number;
  pending: PendingDecision[];
  /** When the next piece appears, after the entry delay that follows a lock. */
  spawnAt: number | null;
  done: boolean;
  /** Frozen clock: the piece the game stopped waiting for. Its answer, if it still comes, is late. */
  timedOutPiece: number | null;
}

export class ArenaSimulation {
  t = 0;
  level: number;
  finished = false;
  private players: Player[];
  private carry = 0;
  private abort = new AbortController();

  /** `sources[i]` decides for `config.agents[i]`. */
  constructor(
    readonly config: RunConfig,
    sources: DecisionSource[],
  ) {
    if (sources.length !== config.agents.length) throw new Error("Need exactly one decision source per board");
    this.level = config.startLevel;
    // Same piece seed for everyone: every board gets the identical sequence.
    const pieceSeed = deriveSeed(config.seed, "pieces");
    this.players = config.agents.map((spec, i) => ({
      spec,
      source: sources[i],
      game: new TetrisGame(pieceSeed),
      candidates: [],
      requestedAt: 0,
      pending: [],
      timedOutPiece: null,
      spawnAt: null,
      done: false,
    }));
  }

  get gravityMs(): number {
    return gravityMsPerRow(this.level);
  }

  start(): ArenaEvent[] {
    const out: ArenaEvent[] = [
      { t: "run_started", at: 0, config: this.config },
      { t: "level", at: 0, level: this.level, gravityMs: this.gravityMs },
    ];
    for (const p of this.players) this.spawn(p, out);
    return out;
  }

  /** Advances the run by `dtMs` of simulated time and returns what happened. */
  step(dtMs: number): ArenaEvent[] {
    const out: ArenaEvent[] = [];
    this.carry += dtMs;
    while (this.carry >= SUBSTEP_MS && !this.finished) {
      this.carry -= SUBSTEP_MS;
      this.substep(SUBSTEP_MS, out);
    }
    return out;
  }

  stop(): ArenaEvent[] {
    this.abort.abort();
    if (this.finished) return [];
    this.finished = true;
    return [{ t: "run_finished", at: this.t, reason: "stopped" }];
  }

  private substep(dt: number, out: ArenaEvent[]) {
    this.t += dt;
    const cfg = this.config;

    const level = Math.min(MAX_LEVEL, cfg.startLevel + Math.floor(this.t / (cfg.levelSeconds * 1000)));
    if (level !== this.level) {
      this.level = level;
      out.push({ t: "level", at: this.t, level, gravityMs: this.gravityMs });
    }

    for (const p of this.players) {
      if (p.done) continue;
      if (p.spawnAt !== null && this.t >= p.spawnAt) {
        p.spawnAt = null;
        this.spawn(p, out);
      }
      this.deliver(p, out);
      if (p.done || !p.game.active) continue;

      if (cfg.mode === "frozen" && !p.game.isDropping) {
        // The game waits for this piece's answer, up to the per-turn limit.
        if (this.t - p.requestedAt >= cfg.frozenTimeoutMs) {
          p.pending = p.pending.filter((d) => d.pieceId !== p.game.pieceId);
          out.push({
            t: "decision",
            at: this.t,
            agentId: p.spec.id,
            pieceId: p.game.pieceId,
            status: "timeout",
            latencyMs: this.t - p.requestedAt,
          });
          p.timedOutPiece = p.game.pieceId;
          p.game.release();
        }
        continue;
      }

      const { moved, lock } = p.game.advance(dt, this.gravityMs, cfg.lockDelayMs, cfg.dropMsPerRow);
      if (lock) this.afterLock(p, lock, out);
      else if (moved) {
        out.push({ t: "move", at: this.t, agentId: p.spec.id, pieceId: p.game.pieceId, cells: p.game.activeCells() });
      }
    }

    if (this.players.every((p) => p.done)) {
      this.finish("all_out", out);
    } else if (this.t >= cfg.maxDurationMs) {
      this.finish("time_limit", out);
    }
  }

  private finish(reason: "all_out" | "time_limit", out: ArenaEvent[]) {
    this.finished = true;
    this.abort.abort();
    out.push({ t: "run_finished", at: this.t, reason });
  }

  private deliver(p: Player, out: ArenaEvent[]) {
    const arrived = p.pending.filter((d) => d.arrivesAt <= this.t);
    if (arrived.length === 0) return;
    p.pending = p.pending.filter((d) => d.arrivesAt > this.t);

    for (const d of arrived) {
      // A piece the frozen clock already gave up on is falling without its answer: too late to steer.
      const current = p.game.active !== null && d.pieceId === p.game.pieceId && d.pieceId !== p.timedOutPiece;
      const base = {
        t: "decision" as const,
        at: this.t,
        agentId: p.spec.id,
        pieceId: d.pieceId,
        latencyMs: d.latencyMs,
        choice: d.choice,
        probabilities: d.probabilities,
        confidence: d.confidence,
        usage: d.usage,
        bestRank: d.choice === undefined ? undefined : d.ranks.get(d.choice),
      };

      const target = d.status === "ok" ? p.candidates.find((c) => c.id === d.choice) : undefined;
      if (d.status === "ok" && current && !target) {
        d.status = "invalid";
        d.detail = `"${d.choice}" is not one of the offered options`;
      }
      if (d.status !== "ok") {
        out.push({
          ...base,
          status: d.status,
          detail: d.detail ?? (d.status === "invalid" ? "Answer was not one of the offered options" : "Request failed"),
        });
        // With the clock frozen there is nothing to wait for; drop the piece where it is.
        if (current && this.config.mode === "frozen") p.game.release();
        continue;
      }
      if (!current) {
        out.push({ ...base, status: "late" });
        continue;
      }
      // The piece lines up over the chosen spot and falls there; it locks when it lands.
      if (!p.game.steer(target!, this.config.movement)) {
        out.push({ ...base, status: "blocked", detail: "The piece had fallen past the chosen spot" });
        continue;
      }
      out.push({ ...base, status: "ok" });
      out.push({ t: "move", at: this.t, agentId: p.spec.id, pieceId: p.game.pieceId, cells: p.game.activeCells() });
    }
  }

  private afterLock(p: Player, lock: LockResult, out: ArenaEvent[]) {
    out.push({
      t: "lock",
      at: this.t,
      agentId: p.spec.id,
      pieceId: p.game.pieceId,
      type: lock.type,
      cells: lock.cells,
      rows: lock.rows,
      byDecision: lock.byDecision,
      board: encodeBoard(p.game.board),
    });
    if (lock.toppedOut) {
      this.topOut(p, out);
      return;
    }
    if (this.config.targetLines > 0 && p.game.lines >= this.config.targetLines) {
      p.done = true;
      p.pending = [];
      out.push({ t: "goal", at: this.t, agentId: p.spec.id, level: this.level, lines: p.game.lines, pieces: p.game.pieces });
      return;
    }
    if (p.game.pieces >= this.config.maxPieces) {
      p.done = true;
      p.pending = [];
      out.push({ t: "survived", at: this.t, agentId: p.spec.id, level: this.level, pieces: p.game.pieces });
      return;
    }
    p.spawnAt = this.t + this.config.entryDelayMs;
  }

  private spawn(p: Player, out: ArenaEvent[]) {
    if (!p.game.spawn()) {
      this.topOut(p, out);
      return;
    }
    const game = p.game;
    p.candidates = game.candidates();
    p.requestedAt = this.t;
    const deadlineMs = this.config.mode === "frozen" ? this.config.frozenTimeoutMs : game.msUntilLock(this.gravityMs, this.config.lockDelayMs);
    out.push({
      t: "spawn",
      at: this.t,
      agentId: p.spec.id,
      pieceId: game.pieceId,
      type: game.active!.type,
      cells: game.activeCells(),
      next: game.preview,
      candidates: p.candidates.map(({ id, rot, x, y, cells }) => ({ id, rot, x, y, cells })),
      deadlineMs,
    });
    this.request(p, deadlineMs);
  }

  private topOut(p: Player, out: ArenaEvent[]) {
    p.done = true;
    p.pending = [];
    out.push({ t: "topout", at: this.t, agentId: p.spec.id, level: this.level });
  }

  /** Asks this board's source for a decision on the piece that just appeared. */
  private request(p: Player, deadlineMs: number) {
    const { game, candidates } = p;
    if (candidates.length === 0) return;
    const pieceId = game.pieceId;
    const requestedAt = this.t;
    const ranks = rankOptions(game.board, game.active!.type, candidates);
    let delivered = false;
    p.source.request(
      {
        agentId: p.spec.id,
        pieceId,
        type: game.active!.type,
        board: encodeBoard(game.board),
        next: game.preview,
        candidates: candidates.map(({ id, rot, x, y, cells }) => ({ id, rot, x, y, cells })),
        level: this.level,
        mode: this.config.mode,
        deadlineMs,
        requestedAt,
      },
      (answer: DecisionAnswer, arrivesAt: number, latencyMs?: number) => {
        if (delivered || p.done || this.finished) return;
        delivered = true;
        p.pending.push({
          ...answer,
          pieceId,
          requestedAt,
          ranks,
          arrivesAt: Math.max(arrivesAt, requestedAt),
          latencyMs: latencyMs ?? Math.max(0, arrivesAt - requestedAt),
        });
      },
      { now: () => this.t, signal: this.abort.signal },
    );
  }
}

/**
 * Ranks every offered option with the reference heuristic (the same one the
 * mock players and the "Heuristic bot" use). Ties share a rank, so 1 means
 * "as good as the heuristic's best".
 */
export function rankOptions(board: Board, type: PieceType, candidates: Candidate[]): Map<string, number> {
  const scores = candidates.map((c) => ({ id: c.id, v: evaluatePlacement(board, type, c) }));
  const ranks = new Map<string, number>();
  for (const a of scores) ranks.set(a.id, 1 + scores.filter((b) => b.v > a.v + 1e-9).length);
  return ranks;
}
