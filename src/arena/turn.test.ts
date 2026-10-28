import { describe, expect, test } from "bun:test";
import { observationText } from "../core/turn";
import { encodeBoard } from "../engine/board";
import { TetrisGame } from "../engine/game";
import { optionDescriptions, stateText, TASK } from "./prompt";
import { tetrisTurn } from "./turn";
import type { TetrisTurnDetail } from "./types";

function firstPiece(): TetrisTurnDetail {
  const game = new TetrisGame(1);
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
  };
}

describe("tetrisTurn", () => {
  const detail = firstPiece();
  const turn = tetrisTurn(detail, 30_000, 5);

  test("offers every landing spot, in the engine's order, with its description", () => {
    expect(turn.action.options.map((o) => o.id)).toEqual(detail.candidates.map((c) => c.id));
    const described = optionDescriptions(detail);
    for (const o of turn.action.options) expect(o.text).toBe(described[o.id]);
  });

  test("shows the board as the observation and the task as instructions", () => {
    expect(observationText(turn)).toBe(stateText(detail));
    expect(turn.instructions).toBe(TASK);
  });

  test("is identified by board and piece, and keeps timing and detail", () => {
    expect(turn.id).toBe("test:1");
    expect(turn.deadlineMs).toBe(30_000);
    expect(turn.requestedAt).toBe(5);
    expect(turn.detail).toBe(detail);
  });
});
