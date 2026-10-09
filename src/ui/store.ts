import type {
  AgentSpec,
  ArenaEvent,
  CandidateView,
  DecisionStatus,
  RunConfig,
} from "../arena/types";
import { decodeBoard, emptyBoard, type Board } from "../engine/board";
import type { Cell, PieceType } from "../engine/pieces";

// Folds the event stream into what the screen needs. State is mutated in place
// and a version number is bumped; React re-renders at most once per frame,
// while canvases read `state` directly on every animation frame.

/** "dropped" is display-only: the piece locked before any answer arrived. */
export type ShownStatus = DecisionStatus | "dropped";

export interface BoardStats {
  lines: number;
  pieces: number;
  /** Pieces the model put where it chose, in time. The board with the most wins the run. */
  landed: number;
  decisions: number;
  late: number;
  dropped: number;
  blocked: number;
  invalid: number;
  errors: number;
  timeouts: number;
  latencies: number[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface Annotation {
  pieceId: number;
  chosen: CandidateView | null;
  alternatives: { candidate: CandidateView; p: number }[];
  chosenP: number | null;
}

export interface BoardState {
  spec: AgentSpec;
  board: Board;
  active: { pieceId: number; type: PieceType; cells: Cell[] } | null;
  next: PieceType[];
  candidates: CandidateView[];
  candidatesFor: number;
  thinking: { pieceId: number; requestedAt: number; deadlineMs: number } | null;
  last: { pieceId: number; status: ShownStatus; latencyMs: number; deadlineMs: number; at: number } | null;
  annotation: Annotation | null;
  lastLock: { pieceId: number; cells: Cell[] } | null;
  flash: { rows: number[]; wall: number } | null;
  stats: BoardStats;
  linesAt: { at: number; lines: number }[];
  outAt: number | null;
  outLevel: number | null;
  survived: boolean;
}

export interface LogLine {
  at: number;
  agent: string | null;
  text: string;
  tone: "normal" | "warn" | "strong";
}

export type RunStatus = "idle" | "running" | "paused" | "finished";

export interface ArenaState {
  config: RunConfig | null;
  status: RunStatus;
  finishReason: string | null;
  level: number;
  gravityMs: number;
  levels: { at: number; level: number }[];
  boards: BoardState[];
  log: LogLine[];
  endAt: number | null;
  lastAt: number;
}

const MAX_LOG = 120;

function emptyStats(): BoardStats {
  return {
    lines: 0,
    pieces: 0,
    landed: 0,
    decisions: 0,
    late: 0,
    dropped: 0,
    blocked: 0,
    invalid: 0,
    errors: 0,
    timeouts: 0,
    latencies: [],
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

function initialState(): ArenaState {
  return {
    config: null,
    status: "idle",
    finishReason: null,
    level: 1,
    gravityMs: 1000,
    levels: [],
    boards: [],
    log: [],
    endAt: null,
    lastAt: 0,
  };
}

export class ArenaStore {
  state: ArenaState = initialState();
  /** Every event of the current run, for export and replay. */
  recording: ArenaEvent[] = [];
  version = 0;
  private listeners = new Set<() => void>();
  private frame: number | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  setStatus(status: RunStatus) {
    this.state.status = status;
    this.changed();
  }

  reset() {
    this.state = initialState();
    this.recording = [];
    this.changed();
  }

  apply = (e: ArenaEvent) => {
    this.recording.push(e);
    const s = this.state;
    s.lastAt = Math.max(s.lastAt, e.at);
    switch (e.t) {
      case "run_started":
        this.state = { ...initialState(), config: e.config, status: "running" };
        this.state.boards = e.config.agents.map((spec) => ({
          spec,
          board: emptyBoard(),
          active: null,
          next: [],
          candidates: [],
          candidatesFor: 0,
          thinking: null,
          last: null,
          annotation: null,
          lastLock: null,
          flash: null,
          stats: emptyStats(),
          linesAt: [{ at: 0, lines: 0 }],
          outAt: null,
          outLevel: null,
          survived: false,
        }));
        this.log(0, null, `Run started on seed ${e.config.seed}, ${e.config.mode === "realtime" ? "real-time clock" : "frozen clock"}`, "strong");
        break;

      case "level":
        s.level = e.level;
        s.gravityMs = e.gravityMs;
        s.levels.push({ at: e.at, level: e.level });
        if (e.at > 0) this.log(e.at, null, `Level ${e.level}: a row every ${fmtMs(e.gravityMs)}`, "normal");
        break;

      case "spawn": {
        const b = this.board(e.agentId);
        b.active = { pieceId: e.pieceId, type: e.type, cells: e.cells };
        b.next = e.next;
        b.candidates = e.candidates;
        b.candidatesFor = e.pieceId;
        b.thinking = { pieceId: e.pieceId, requestedAt: e.at, deadlineMs: e.deadlineMs };
        break;
      }

      case "move": {
        const b = this.board(e.agentId);
        if (b.active && b.active.pieceId === e.pieceId) b.active.cells = e.cells;
        break;
      }

      case "decision": {
        const b = this.board(e.agentId);
        const st = b.stats;
        st.decisions += 1;
        st.latencies.push(e.latencyMs);
        if (e.usage) {
          st.costUsd += e.usage.costUsd;
          st.inputTokens += e.usage.inputTokens;
          st.outputTokens += e.usage.outputTokens;
        }
        if (e.status === "late") st.late += 1;
        if (e.status === "blocked") st.blocked += 1;
        if (e.status === "invalid") st.invalid += 1;
        if (e.status === "error") st.errors += 1;
        if (e.status === "timeout") st.timeouts += 1;

        const isCurrent = b.thinking?.pieceId === e.pieceId;
        if (e.status === "late" && b.last?.pieceId === e.pieceId) {
          // The piece already dropped; now we know how late the answer was.
          b.last = { ...b.last, status: "late", latencyMs: e.latencyMs };
        } else if (isCurrent || e.status !== "late") {
          b.last = {
            pieceId: e.pieceId,
            status: e.status,
            latencyMs: e.latencyMs,
            deadlineMs: b.thinking?.pieceId === e.pieceId ? b.thinking.deadlineMs : b.last?.deadlineMs ?? 0,
            at: e.at,
          };
        }
        if (isCurrent) b.thinking = null;

        if (e.status === "ok" && b.candidatesFor === e.pieceId) {
          b.annotation = annotate(b.candidates, e.pieceId, e.choice, e.probabilities);
        }
        if (e.status !== "ok") {
          const name = b.spec.name;
          const msg = {
            late: `answered ${fmtMs(e.latencyMs)} after asking, but the piece had already locked`,
            blocked: `chose ${e.choice}, but the piece had already fallen past it`,
            invalid: "answered with something that wasn't one of the options",
            error: "request failed",
            timeout: `gave no answer within ${fmtMs(e.latencyMs)}`,
          }[e.status];
          this.log(e.at, name, msg, "warn");
        }
        break;
      }

      case "lock": {
        const b = this.board(e.agentId);
        b.board = decodeBoard(e.board);
        b.active = null;
        b.lastLock = { pieceId: e.pieceId, cells: e.cells };
        b.stats.pieces += 1;
        if (e.byDecision) b.stats.landed += 1;
        if (!e.byDecision && b.thinking?.pieceId === e.pieceId) {
          b.stats.dropped += 1;
          b.last = {
            pieceId: e.pieceId,
            status: "dropped",
            latencyMs: e.at - b.thinking.requestedAt,
            deadlineMs: b.thinking.deadlineMs,
            at: e.at,
          };
          b.thinking = null;
          b.annotation = null;
        }
        if (e.rows.length > 0) {
          b.stats.lines += e.rows.length;
          b.linesAt.push({ at: e.at, lines: b.stats.lines });
          b.flash = { rows: e.rows, wall: performance.now() };
          if (e.rows.length === 4) this.log(e.at, b.spec.name, "cleared four lines at once", "normal");
        }
        break;
      }

      case "topout": {
        const b = this.board(e.agentId);
        b.outAt = e.at;
        b.outLevel = e.level;
        b.thinking = null;
        b.active = null;
        this.log(e.at, b.spec.name, `topped out at ${fmtSeconds(e.at)}, level ${e.level}`, "strong");
        break;
      }

      case "survived": {
        const b = this.board(e.agentId);
        b.outAt = e.at;
        b.outLevel = e.level;
        b.survived = true;
        b.thinking = null;
        b.active = null;
        this.log(e.at, b.spec.name, `placed all ${e.pieces} pieces and stopped`, "strong");
        break;
      }

      case "run_finished":
        s.status = "finished";
        s.endAt = e.at;
        s.finishReason = e.reason;
        this.log(e.at, null, { all_out: "Run finished: every board is done", time_limit: "Run finished: time limit reached", stopped: "Run stopped" }[e.reason], "strong");
        break;
    }
    this.changed();
  };

  private board(agentId: string): BoardState {
    const b = this.state.boards.find((x) => x.spec.id === agentId);
    if (!b) throw new Error(`No board for agent ${agentId}`);
    return b;
  }

  private log(at: number, agent: string | null, text: string, tone: LogLine["tone"]) {
    const log = this.state.log;
    log.unshift({ at, agent, text, tone });
    if (log.length > MAX_LOG) log.length = MAX_LOG;
  }

  private changed() {
    this.version += 1;
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      for (const l of this.listeners) l();
    });
  }
}

function annotate(
  candidates: CandidateView[],
  pieceId: number,
  choice: string | undefined,
  probabilities: Record<string, number> | undefined,
): Annotation {
  const chosen = candidates.find((c) => c.id === choice) ?? null;
  if (!probabilities) return { pieceId, chosen, alternatives: [], chosenP: null };
  const alternatives = candidates
    .filter((c) => c.id !== choice)
    .map((candidate) => ({ candidate, p: probabilities[candidate.id] ?? 0 }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 2)
    .filter((a) => a.p >= 0.01);
  return { pieceId, chosen, alternatives, chosenP: choice ? probabilities[choice] ?? null : null };
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export function fmtMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function fmtSeconds(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
