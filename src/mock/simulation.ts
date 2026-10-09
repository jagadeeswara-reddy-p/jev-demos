import { encodeBoard } from "../engine/board";
import { MAX_LEVEL, TetrisGame, gravityMsPerRow, type Candidate, type LockResult } from "../engine/game";
import { evaluatePlacement, softmax } from "../engine/heuristic";
import { createRng, deriveSeed, type Rng } from "../engine/rng";
import type { AgentSpec, ArenaEvent, DecisionStatus, DecisionUsage, RunConfig } from "../arena/types";
import { getProfile, type MockProfile } from "./profiles";

// A deterministic, headless arena run. Everything (pieces, latencies, choices)
// comes from the run seed, so the same config always produces the same events.
// The MockBackend drives this with a wall clock; tests drive it directly.

const SUBSTEP_MS = 4;

interface PendingDecision {
  pieceId: number;
  requestedAt: number;
  arrivesAt: number;
  status: Extract<DecisionStatus, "ok" | "invalid" | "error">;
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  usage: DecisionUsage;
}

interface Player {
  spec: AgentSpec;
  profile: MockProfile;
  game: TetrisGame;
  rng: Rng;
  candidates: Candidate[];
  requestedAt: number;
  pending: PendingDecision[];
  /** When the next piece appears, after the entry delay that follows a lock. */
  spawnAt: number | null;
  done: boolean;
}

export class ArenaSimulation {
  t = 0;
  level: number;
  finished = false;
  private players: Player[];
  private carry = 0;

  constructor(
    readonly config: RunConfig,
    resolveProfile: (sourceId: string) => MockProfile = getProfile,
  ) {
    this.level = config.startLevel;
    // Same piece seed for everyone: every board gets the identical sequence.
    const pieceSeed = deriveSeed(config.seed, "pieces");
    this.players = config.agents.map((spec, i) => ({
      spec,
      profile: resolveProfile(spec.sourceId),
      game: new TetrisGame(pieceSeed),
      rng: createRng(deriveSeed(config.seed, `agent:${i}:${spec.sourceId}`)),
      candidates: [],
      requestedAt: 0,
      pending: [],
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

      if (cfg.mode === "frozen") {
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
          this.afterLock(p, p.game.hardDrop()!, out);
        }
        continue;
      }

      const { moved, lock } = p.game.advance(dt, this.gravityMs, cfg.lockDelayMs);
      if (lock) this.afterLock(p, lock, out);
      else if (moved) {
        out.push({ t: "move", at: this.t, agentId: p.spec.id, pieceId: p.game.pieceId, cells: p.game.activeCells() });
      }
    }

    if (this.players.every((p) => p.done)) {
      this.finished = true;
      out.push({ t: "run_finished", at: this.t, reason: "all_out" });
    } else if (this.t >= cfg.maxDurationMs) {
      this.finished = true;
      out.push({ t: "run_finished", at: this.t, reason: "time_limit" });
    }
  }

  private deliver(p: Player, out: ArenaEvent[]) {
    const arrived = p.pending.filter((d) => d.arrivesAt <= this.t);
    if (arrived.length === 0) return;
    p.pending = p.pending.filter((d) => d.arrivesAt > this.t);

    for (const d of arrived) {
      const current = p.game.active !== null && d.pieceId === p.game.pieceId;
      const base = {
        t: "decision" as const,
        at: this.t,
        agentId: p.spec.id,
        pieceId: d.pieceId,
        latencyMs: d.arrivesAt - d.requestedAt,
        choice: d.choice,
        probabilities: d.probabilities,
        confidence: d.confidence,
        usage: d.usage,
      };

      if (d.status !== "ok") {
        out.push({ ...base, status: d.status, detail: d.status === "invalid" ? "Answer was not one of the offered options" : "Request failed" });
        // With the clock frozen there is nothing to wait for; drop the piece where it is.
        if (current && this.config.mode === "frozen") this.afterLock(p, p.game.hardDrop()!, out);
        continue;
      }
      if (!current) {
        out.push({ ...base, status: "late" });
        continue;
      }
      const target = p.candidates.find((c) => c.id === d.choice)!;
      const lock = this.config.movement === "path" ? p.game.applyPlacement(target) : p.game.placeAt(target);
      if (!lock) {
        out.push({ ...base, status: "blocked", detail: "The piece had fallen past the chosen spot" });
        continue;
      }
      out.push({ ...base, status: "ok" });
      this.afterLock(p, lock, out);
      if (p.done) return;
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
    const deadlineMs =
      this.config.mode === "frozen" ? this.config.frozenTimeoutMs : game.msUntilLock(this.gravityMs, this.config.lockDelayMs);
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
    this.request(p);
  }

  private topOut(p: Player, out: ArenaEvent[]) {
    p.done = true;
    p.pending = [];
    out.push({ t: "topout", at: this.t, agentId: p.spec.id, level: this.level });
  }

  /** Imitates sending the board to the model: decides now what it will answer and when. */
  private request(p: Player) {
    const { profile, rng, game, candidates } = p;
    if (candidates.length === 0) return;

    const u = rng();
    if (u < profile.hangRate) return; // never answers

    const latency = Math.max(1, profile.latency.medianMs * Math.exp(profile.latency.spread * gaussian(rng)));
    const pending: PendingDecision = {
      pieceId: game.pieceId,
      requestedAt: this.t,
      arrivesAt: this.t + latency,
      status: "ok",
      usage: { ...profile.usage },
    };

    const roll = rng();
    if (roll < profile.errorRate) {
      pending.status = "error";
    } else if (roll < profile.errorRate + profile.invalidRate) {
      pending.status = "invalid";
    } else {
      const type = game.active!.type;
      const scores = candidates.map((c) => evaluatePlacement(game.board, type, c));
      const probs = softmax(scores, profile.temperature);
      const pick = sample(probs, rng());
      pending.choice = candidates[pick].id;
      // Only System One models return a calibrated distribution; chat models just name an option.
      if (profile.kind === "system-one") {
        pending.probabilities = Object.fromEntries(candidates.map((c, i) => [c.id, probs[i]]));
        pending.confidence = confidenceOf(probs);
      }
    }
    p.pending.push(pending);
  }
}

function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function sample(probs: number[], u: number): number {
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i];
    if (u < acc) return i;
  }
  return probs.length - 1;
}

/** 1 when all mass is on one option, 0 when it is spread evenly. */
function confidenceOf(probs: number[]): number {
  if (probs.length < 2) return 1;
  const h = -probs.reduce((s, p) => (p > 0 ? s + p * Math.log(p) : s), 0);
  return 1 - h / Math.log(probs.length);
}
