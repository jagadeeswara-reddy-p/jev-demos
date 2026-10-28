import type { Turn } from "../core/types";
import { optionDescriptions, stateText, TASK } from "./prompt";
import type { TetrisTurnDetail } from "./types";

/** The question for one piece: the board as text, and every landing spot as an option, in the engine's order. */
export function tetrisTurn(detail: TetrisTurnDetail, deadlineMs: number, requestedAt: number): Turn<TetrisTurnDetail> {
  const described = optionDescriptions(detail);
  return {
    id: `${detail.agentId}:${detail.pieceId}`,
    instructions: TASK,
    observation: [{ type: "text", text: stateText(detail) }],
    action: { kind: "choice", options: detail.candidates.map((c) => ({ id: c.id, text: described[c.id] })) },
    deadlineMs,
    requestedAt,
    detail,
  };
}
