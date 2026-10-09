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
  /** In frozen mode, how long the game waits for a decision before dropping the piece. */
  frozenTimeoutMs: number;
  /** Ends the run even if somebody is still alive. */
  maxDurationMs: number;
  /** A board that places this many pieces stops playing and counts as a survivor. */
  maxPieces: number;
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
  | { t: "run_finished"; at: number; reason: "all_out" | "time_limit" | "stopped" };

export type ArenaEventOf<T extends ArenaEvent["t"]> = Extract<ArenaEvent, { t: T }>;

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
  frozenTimeoutMs: 30_000,
  maxDurationMs: 10 * 60_000,
  maxPieces: 1000,
};
