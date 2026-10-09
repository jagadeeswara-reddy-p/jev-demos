import type { ArenaBackend, ArenaEvent, RunConfig } from "./types";

// Shared plumbing for backends that run on simulated time: a wall-clock loop
// that turns elapsed real time (times the speed multiplier) into simulated time.
export abstract class ClockedBackend implements ArenaBackend {
  private listeners = new Set<(e: ArenaEvent) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastWall = 0;
  protected speed = 1;
  protected running = false;

  abstract start(config: RunConfig): void;
  abstract now(): number;
  /** Advance by `dtMs` of simulated time; return false once the run is over. */
  protected abstract advance(dtMs: number): boolean;

  subscribe(listener: (e: ArenaEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSpeed(multiplier: number) {
    this.speed = multiplier;
  }

  pause() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  resume() {
    if (this.running) return;
    this.running = true;
    this.lastWall = performance.now();
    this.loop();
  }

  stop() {
    this.pause();
  }

  protected emit(events: ArenaEvent[]) {
    for (const e of events) for (const l of this.listeners) l(e);
  }

  private loop = () => {
    if (!this.running) return;
    const wall = performance.now();
    // Cap a single frame so a backgrounded tab doesn't fast-forward the game.
    const dt = Math.min(wall - this.lastWall, 100) * this.speed;
    this.lastWall = wall;
    if (!this.advance(dt)) {
      this.running = false;
      return;
    }
    this.timer = setTimeout(this.loop, 16);
  };
}
