import { ClockedBackend } from "../arena/clockedBackend";
import { tetris } from "../arena/environment";
import type { ArenaEvent, RunConfig } from "../arena/types";
import type { Match } from "../core/types";
import { mockSourceFor } from "./mockSource";

// Runs a mock-only line-up in the browser. Because mock models answer in
// simulated time, the whole run can be played at any speed.
export class MockBackend extends ClockedBackend {
  private sim: Match<ArenaEvent> | null = null;

  start(config: RunConfig) {
    this.pause();
    this.sim = tetris.createMatch(
      config,
      config.agents.map((spec) => mockSourceFor(config, spec)),
    );
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
