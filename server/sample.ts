import { tetrisTurn } from "../src/arena/turn";
import type { TetrisTurnDetail } from "../src/arena/types";
import type { Answer, Turn } from "../src/core/types";
import { encodeBoard } from "../src/engine/board";
import { TetrisGame } from "../src/engine/game";
import { sourceFor } from "./adapters";
import type { ModelConfig } from "./models/types";

// One real decision outside a run: the first piece of a seeded game, with every
// landing spot as an option. Used by the page's Test button and the smoke script.

export function sampleTurn(seed = 1): Turn<TetrisTurnDetail> {
  const game = new TetrisGame(seed);
  game.spawn();
  const detail: TetrisTurnDetail = {
    agentId: "test",
    pieceId: game.pieceId,
    type: game.active!.type,
    board: encodeBoard(game.board),
    next: game.preview,
    candidates: game.candidates().map(({ id, rot, x, y, cells }) => ({ id, rot, x, y, cells })),
    level: 1,
    mode: "frozen",
  };
  return tetrisTurn(detail, 30_000, 0);
}

export interface TestResult extends Answer {
  latencyMs: number;
  /** How many options the model was offered. */
  options: number;
}

/** Sends one decision and waits for the answer (errors and timeouts come back as answers too). */
export function testModel(model: ModelConfig, turn = sampleTurn()): Promise<TestResult> {
  const offered = new Set(turn.action.options.map((o) => o.id));
  return new Promise((resolve) => {
    sourceFor(model).request(
      turn,
      (answer, _at, latencyMs) => {
        const named = answer.status !== "ok" || offered.has(answer.choice ?? "");
        resolve({
          ...(named ? answer : { ...answer, status: "invalid", detail: `"${answer.choice}" isn't one of the offered options` }),
          latencyMs: Math.round(latencyMs ?? 0),
          options: turn.action.options.length,
        });
      },
      { now: () => 0, signal: new AbortController().signal },
    );
  });
}
