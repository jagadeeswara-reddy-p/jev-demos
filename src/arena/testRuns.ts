import { mockSourceFor } from "../mock/mockSource";
import { MOCK_PROFILES } from "../mock/profiles";
import { ArenaSimulation } from "./simulation";
import { type ArenaEvent, type ClockMode, DEFAULT_CONFIG, type RunConfig } from "./types";

// Mock runs for tests that pin down behaviour: every mock profile on one
// seed, played to the end. The log is hashed the way a JSONL run file stores it.

export function mockLineup(mode: ClockMode, seed: number): RunConfig {
  return {
    ...DEFAULT_CONFIG,
    seed,
    maxPieces: 300,
    mode,
    agents: MOCK_PROFILES.map((p, i) => ({ id: `a${i}`, name: p.id, kind: p.kind, sourceId: p.id })),
  };
}

export function runMockLineup(cfg: RunConfig): ArenaEvent[] {
  const sim = new ArenaSimulation(
    cfg,
    cfg.agents.map((a) => mockSourceFor(cfg, a)),
  );
  const events = sim.start();
  while (!sim.finished) events.push(...sim.step(1000));
  return events;
}

export function logDigest(events: ArenaEvent[]): { events: number; sha256: string } {
  const jsonl = events.map((e) => JSON.stringify(e)).join("\n");
  return { events: events.length, sha256: new Bun.CryptoHasher("sha256").update(jsonl).digest("hex") };
}
