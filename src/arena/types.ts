import type { Cell, PieceType } from "../engine/pieces";

// The contract between a backend (mock today, real server later) and the UI.
// Every run is fully described by its config plus the ordered event stream,
// which is also what gets saved and replayed.

export type AgentKind = "system-one" | "llm" | "baseline";
export type ClockMode = "realtime" | "frozen";

export interface AgentSpec {
  id: string;
  name: string;
  kind: AgentKind;
  /** Which decision source drives this board: a mock profile id now, a provider adapter later. */
  sourceId: string;
}

export interface RunConfig {
  seed: number;
  mode: ClockMode;
  agents: AgentSpec[];
  startLevel: number;
  /** Levels rise on a shared clock, independent of lines cleared. */
  levelSeconds: number;
  lockDelayMs: number;
  /** Pause between a piece locking and the next one appearing (the guideline's "ARE"). */
  entryDelayMs: number;
  /**
   * How an in-time answer is carried out. "place": the piece goes straight to the
   * chosen spot (the deadline is the lock). "path": it must still be reachable by
   * moving from wherever gravity has taken it, so slow answers can also be "blocked".
   */
  movement: "place" | "path";
  /**
   * How fast a piece falls once its spot is chosen (or the frozen clock gives up
   * on it), in ms per row, capped at gravity. 0 drops it instantly.
   */
  dropMsPerRow: number;
  /** In frozen mode, how long the game waits for a decision before dropping the piece. */
  frozenTimeoutMs: number;
  /** Ends the run even if somebody is still alive. */
  maxDurationMs: number;
  /** A board that places this many pieces stops playing and counts as a survivor. */
  maxPieces: number;
  /**
   * Sprint mode: a board that clears this many lines is done, and the race is
   * to get there first (real time) or in the fewest pieces (frozen clock).
   * 0 turns it off: the run is about lasting as long as possible.
   */
  targetLines: number;
}

export interface CandidateView {
  id: string;
  rot: number;
  x: number;
  y: number;
  cells: Cell[];
}

export type DecisionStatus =
  | "ok" // arrived in time and was applied
  | "late" // arrived after the piece had already locked
  | "blocked" // arrived in time, but the chosen spot could no longer be reached
  | "invalid" // response did not name one of the offered options
  | "error" // request failed
  | "timeout"; // frozen mode only: no answer within the per-turn limit

export interface DecisionUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export type ArenaEvent =
  | { t: "run_started"; at: number; config: RunConfig }
  | { t: "level"; at: number; level: number; gravityMs: number }
  | {
      t: "spawn";
      at: number;
      agentId: string;
      pieceId: number;
      type: PieceType;
      cells: Cell[];
      next: PieceType[];
      candidates: CandidateView[];
      /** How long until this piece locks if no decision arrives. */
      deadlineMs: number;
    }
  | { t: "move"; at: number; agentId: string; pieceId: number; cells: Cell[] }
  | {
      t: "decision";
      at: number;
      agentId: string;
      pieceId: number;
      status: DecisionStatus;
      latencyMs: number;
      choice?: string;
      probabilities?: Record<string, number>;
      confidence?: number;
      usage?: DecisionUsage;
      detail?: string;
      /**
       * Where the chosen option ranks among the offered ones by the reference
       * heuristic (1 = its top pick). Set for any answer that names a real
       * option, on time or not, so it measures move quality apart from speed.
       */
      bestRank?: number;
    }
  | {
      t: "lock";
      at: number;
      agentId: string;
      pieceId: number;
      type: PieceType;
      cells: Cell[];
      rows: number[];
      byDecision: boolean;
      /** Board after the lock and any line clears, one char per cell. */
      board: string;
    }
  | { t: "topout"; at: number; agentId: string; level: number }
  | { t: "survived"; at: number; agentId: string; level: number; pieces: number }
  /** Sprint mode: the board reached the line target. */
  | { t: "goal"; at: number; agentId: string; level: number; lines: number; pieces: number }
  | { t: "run_finished"; at: number; reason: "all_out" | "time_limit" | "stopped" };

export type ArenaEventOf<T extends ArenaEvent["t"]> = Extract<ArenaEvent, { t: T }>;

// ---------- decision sources ----------

/** Everything a model is shown for one piece. Identical for every board in a run. */
export interface DecisionRequest {
  agentId: string;
  pieceId: number;
  type: PieceType;
  /** Board before placing the piece, one char per cell including the hidden rows. */
  board: string;
  next: PieceType[];
  candidates: CandidateView[];
  level: number;
  mode: ClockMode;
  deadlineMs: number;
  /** Simulated time the request was made. */
  requestedAt: number;
}

export interface DecisionAnswer {
  status: "ok" | "invalid" | "error";
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  usage?: DecisionUsage;
  detail?: string;
}

/**
 * Hands an answer back to the run. `arrivesAt` is in simulated time; pass the
 * measured wall-clock latency for live calls, or leave it out to use arrivesAt - requestedAt.
 */
export type DeliverAnswer = (answer: DecisionAnswer, arrivesAt: number, latencyMs?: number) => void;

export interface DecisionContext {
  /** Current simulated time of the run. */
  now(): number;
  /** Aborted when the run stops, so in-flight HTTP calls can be cancelled. */
  signal: AbortSignal;
}

/** Something that picks landing spots: a mock profile, Jev, or an LLM. */
export interface DecisionSource {
  /** Called once per piece. Call `deliver` once with the answer, or never to simulate a hang. */
  request(req: DecisionRequest, deliver: DeliverAnswer, ctx: DecisionContext): void;
}

/** What the UI knows about a source. Never includes keys. */
export interface SourceInfo {
  id: string;
  label: string;
  kind: AgentKind;
  description: string;
  /** Live sources call a real API and can only run on the server, at 1×. */
  live: boolean;
  available: boolean;
  /** Why an unavailable source can't be used, e.g. a missing key. */
  reason?: string;
}

export interface ArenaBackend {
  start(config: RunConfig): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setSpeed(multiplier: number): void;
  /** Current simulation time in ms, for smooth timers between events. */
  now(): number;
  subscribe(listener: (event: ArenaEvent) => void): () => void;
}

export const DEFAULT_CONFIG: Omit<RunConfig, "agents" | "seed" | "mode"> = {
  startLevel: 1,
  levelSeconds: 15,
  lockDelayMs: 500,
  entryDelayMs: 200,
  movement: "place",
  dropMsPerRow: 30,
  frozenTimeoutMs: 30_000,
  maxDurationMs: 10 * 60_000,
  maxPieces: 1000,
  targetLines: 0,
};

/** The line target offered in the page for sprint mode. */
export const SPRINT_LINES = 40;
