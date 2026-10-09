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
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

export function fromJsonl(text: string): ArenaEvent[] {
  const events = text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as ArenaEvent);
  if (events[0]?.t !== "run_started") throw new Error("This file is not a run log: it must start with a run_started event.");
  return events;
}
