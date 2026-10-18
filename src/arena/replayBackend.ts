import { PIECE_TYPES, type PieceType } from "../engine/pieces";
import { ClockedBackend } from "./clockedBackend";
import type { ArenaEvent, RunConfig } from "./types";

// Plays back a recorded run at any speed. A run log is just its events, one
// JSON object per line, so live runs and replays render through the same path.
export class ReplayBackend extends ClockedBackend {
  private cursor = 0;
  private t = 0;

  constructor(private events: ArenaEvent[]) {
    super();
  }

  /** The config is taken from the log; the argument is ignored. */
  start(_config?: RunConfig) {
    this.pause();
    this.cursor = 0;
    this.t = 0;
    this.advance(0);
    this.resume();
  }

  now() {
    return this.t;
  }

  protected advance(dtMs: number) {
    this.t += dtMs;
    const due: ArenaEvent[] = [];
    while (this.cursor < this.events.length && this.events[this.cursor].at <= this.t) {
      due.push(this.events[this.cursor++]);
    }
    this.emit(due);
    return this.cursor < this.events.length;
  }
}

export function toJsonl(events: ArenaEvent[]): string {
  return `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

const EVENT_TYPES = new Set(["run_started", "level", "spawn", "move", "decision", "lock", "topout", "survived", "goal", "run_finished"]);
const isCells = (v: unknown) => Array.isArray(v) && v.every((c) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite));

/**
 * Reads a run log, checking each event so a damaged or hand-edited file is refused with
 * the line that's wrong, instead of stalling the replay. A log that was cut short (no
 * run_finished) gets one at its last event, so the replay ends cleanly.
 */
export function fromJsonl(text: string): ArenaEvent[] {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const events: ArenaEvent[] = [];
  let boards = new Set<string>();
  lines.forEach((line, i) => {
    const where = `line ${i + 1}`;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      throw new Error(`${where} is not JSON.`);
    }
    if (typeof e !== "object" || e === null || !EVENT_TYPES.has(e.t as string)) throw new Error(`${where} is not a run event.`);
    if (i === 0 && e.t !== "run_started") throw new Error("This file is not a run log: it must start with a run_started event.");
    if (typeof e.at !== "number" || !Number.isFinite(e.at) || e.at < 0) throw new Error(`${where} has no valid time.`);
    if (e.t === "run_started") {
      const agents = (e.config as { agents?: { id?: unknown }[] } | undefined)?.agents;
      if (!Array.isArray(agents) || agents.some((a) => typeof a?.id !== "string")) throw new Error(`${where} has no boards in its config.`);
      boards = new Set(agents.map((a) => a.id as string));
    } else if ("agentId" in e && !boards.has(e.agentId as string)) {
      throw new Error(`${where} is for a board the run doesn't have.`);
    }
    if (e.t === "spawn") {
      const pieces = [e.type, ...(Array.isArray(e.next) ? e.next : [null])];
      if (!pieces.every((p) => PIECE_TYPES.includes(p as PieceType)) || !isCells(e.cells) || !Array.isArray(e.candidates)) {
        throw new Error(`${where} has a malformed piece.`);
      }
    }
    if ((e.t === "move" || e.t === "lock") && !isCells(e.cells)) throw new Error(`${where} has malformed cells.`);
    events.push(e as unknown as ArenaEvent);
  });
  const last = events.at(-1);
  if (last && last.t !== "run_finished") events.push({ t: "run_finished", at: last.at, reason: "stopped" });
  return events;
}
