import { decodeBoard } from "../engine/board";
import { evaluatePlacement, softmax } from "../engine/heuristic";
import { createRng, deriveSeed, type Rng } from "../engine/rng";
import type { AgentSpec, DecisionSource, RunConfig, SourceInfo } from "../arena/types";
import { MOCK_PROFILES, getProfile, type MockProfile } from "./profiles";

/**
 * A pretend model. It decides at request time what it will answer and when,
 * and delivers in simulated time, so a mock run is reproducible from its seed
 * and can be played at any speed.
 */
export function createMockSource(profile: MockProfile, seed: number): DecisionSource {
  const rng = createRng(seed);
  return {
    request(req, deliver) {
      if (rng() < profile.hangRate) return; // never answers

      const latency = Math.max(1, profile.latency.medianMs * Math.exp(profile.latency.spread * gaussian(rng)));
      const arrivesAt = req.requestedAt + latency;
      const usage = { ...profile.usage };

      const roll = rng();
      if (roll < profile.errorRate) return deliver({ status: "error", usage, detail: "Request failed" }, arrivesAt);
      if (roll < profile.errorRate + profile.invalidRate) return deliver({ status: "invalid", usage }, arrivesAt);

      const board = decodeBoard(req.board);
      const scores = req.candidates.map((c) => evaluatePlacement(board, req.type, c));
      const probs = softmax(scores, profile.temperature);
      const choice = req.candidates[sample(probs, rng())].id;
      // Only System One models return a calibrated distribution; chat models just name an option.
      if (profile.kind === "system-one") {
        deliver(
          {
            status: "ok",
            choice,
            usage,
            probabilities: Object.fromEntries(req.candidates.map((c, i) => [c.id, probs[i]])),
            confidence: confidenceOf(probs),
          },
          arrivesAt,
        );
      } else {
        deliver({ status: "ok", choice, usage }, arrivesAt);
      }
    },
  };
}

export const MOCK_SOURCES: SourceInfo[] = MOCK_PROFILES.map((p) => ({
  id: p.id,
  label: p.label,
  kind: p.kind,
  description: p.description,
  live: false,
  available: true,
}));

export function isMockSource(sourceId: string): boolean {
  return MOCK_PROFILES.some((p) => p.id === sourceId);
}

/** A mock source for one board, seeded from the run seed and the board's position. */
export function mockSourceFor(config: RunConfig, spec: AgentSpec): DecisionSource {
  const index = config.agents.indexOf(spec);
  return createMockSource(getProfile(spec.sourceId), deriveSeed(config.seed, `agent:${index}:${spec.sourceId}`));
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
