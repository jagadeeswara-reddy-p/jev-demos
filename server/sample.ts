import type { DecisionAnswer, DecisionRequest } from "../src/arena/types";
import { encodeBoard } from "../src/engine/board";
import { TetrisGame } from "../src/engine/game";
import { sourceFor } from "./adapters";
import type { ModelConfig } from "./models/types";

// One real decision outside a run: the first piece of a seeded game, with every
// landing spot as an option. Used by the page's Test button and the smoke script.

export function sampleRequest(seed = 1): DecisionRequest {
  const game = new TetrisGame(seed);
  game.spawn();
  return {
    agentId: "test",
    pieceId: game.pieceId,
    type: game.active!.type,
    board: encodeBoard(game.board),
    next: game.preview,
    candidates: game.candidates().map(({ id, rot, x, y, cells }) => ({ id, rot, x, y, cells })),
    level: 1,
    mode: "frozen",
    deadlineMs: 30_000,
    requestedAt: 0,
  };
}

export interface TestResult extends DecisionAnswer {
  latencyMs: number;
  /** How many options the model was offered. */
  options: number;
}

/** Sends one decision and waits for the answer (errors and timeouts come back as answers too). */
export function testModel(model: ModelConfig, req = sampleRequest()): Promise<TestResult> {
  const offered = new Set(req.candidates.map((c) => c.id));
  return new Promise((resolve) => {
    sourceFor(model).request(
      req,
      (answer, _at, latencyMs) => {
        const named = answer.status !== "ok" || offered.has(answer.choice ?? "");
        resolve({
          ...(named ? answer : { ...answer, status: "invalid", detail: `"${answer.choice}" isn't one of the offered options` }),
          latencyMs: Math.round(latencyMs ?? 0),
          options: req.candidates.length,
        });
      },
      { now: () => 0, signal: new AbortController().signal },
    );
  });
}
