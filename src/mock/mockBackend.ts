import { ClockedBackend } from "../arena/clockedBackend";
import type { RunConfig } from "../arena/types";
import { ArenaSimulation } from "./simulation";

// Stands in for the real server: runs the simulation in the browser and emits
// the same events the server will stream. Swap it out, and the UI stays the same.
export class MockBackend extends ClockedBackend {
  private sim: ArenaSimulation | null = null;

  start(config: RunConfig) {
    this.pause();
    this.sim = new ArenaSimulation(config);
    this.emit(this.sim.start());
    this.resume();
  }

  stop() {
    super.stop();
    if (this.sim) this.emit(this.sim.stop());
  }

  now() {
    return this.sim?.t ?? 0;
  }

  protected advance(dtMs: number) {
    const sim = this.sim;
    if (!sim) return false;
    this.emit(sim.step(dtMs));
    return !sim.finished;
  }
}
