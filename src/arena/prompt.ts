import { type Board, clearRows, decodeBoard, fullRows, HEIGHT, HIDDEN_ROWS, place, VISIBLE_HEIGHT, WIDTH } from "../engine/board";
import type { CandidateView, DecisionRequest } from "./types";

// What every model is shown for one piece. Jev and the LLM get the same state
// text and the same option descriptions, word for word; only the transport
// differs (a Choice question vs a JSON answer), so neither gets a better view.
//
// Each option carries its consequences (lines cleared, holes, stack height,
// bumpiness), computed here on purpose. Jev is a System One model: it scores
// predefined options and returns probabilities rather than reasoning through
// board geometry. The arena does the geometry and the models do the choosing,
// so the comparison is about picking fast and well, not spatial reasoning.
// That is also why there is no variant that sends options without these numbers.

export const TASK =
  "You are playing Tetris. Choose where the current piece should land. " +
  "Good placements clear lines, avoid creating holes, and keep the stack low and flat.";

export interface CandidateFeatures {
  linesCleared: number;
  holesAdded: number;
  stackHeight: number;
  bumpiness: number;
  /** Rows from the floor to the lowest cell of the piece (1 = touching the floor). */
  landsAt: number;
  columns: [number, number];
}

export function boardText(board: Board): string {
  const rows: string[] = [];
  for (let y = HIDDEN_ROWS; y < HEIGHT; y++) {
    let row = "";
    for (let x = 0; x < WIDTH; x++) row += board[y * WIDTH + x] === "." ? "." : "#";
    rows.push(row);
  }
  return rows.join("\n");
}

export function stateText(req: DecisionRequest): string {
  const board = decodeBoard(req.board);
  return [
    `Board, ${WIDTH} columns by ${VISIBLE_HEIGHT} rows, top row first ("#" filled, "." empty):`,
    boardText(board),
    "",
    `Current piece: ${req.type}`,
    `Next pieces: ${req.next.join(", ") || "unknown"}`,
    `Level: ${req.level}`,
  ].join("\n");
}

export function candidateFeatures(board: Board, type: DecisionRequest["type"], c: CandidateView): CandidateFeatures {
  const before = holes(board);
  const placed = place(board, c.cells, type);
  const rows = fullRows(placed);
  const after = clearRows(placed, rows);
  const heights = columnHeights(after);
  const xs = c.cells.map(([x]) => x);
  const lowest = Math.max(...c.cells.map(([, y]) => y));
  return {
    linesCleared: rows.length,
    holesAdded: holes(after) - before,
    stackHeight: Math.max(...heights),
    bumpiness: heights.slice(1).reduce((s, h, i) => s + Math.abs(h - heights[i]), 0),
    landsAt: HEIGHT - lowest,
    columns: [Math.min(...xs) + 1, Math.max(...xs) + 1],
  };
}

export function describeCandidate(f: CandidateFeatures, c: CandidateView): string {
  const cols = f.columns[0] === f.columns[1] ? `column ${f.columns[0]}` : `columns ${f.columns[0]}-${f.columns[1]}`;
  const lines = f.linesCleared === 0 ? "clears no lines" : `clears ${f.linesCleared} line${f.linesCleared > 1 ? "s" : ""}`;
  const holesText =
    f.holesAdded > 0
      ? `creates ${f.holesAdded} hole${f.holesAdded > 1 ? "s" : ""}`
      : f.holesAdded < 0
        ? `opens ${-f.holesAdded} hole${f.holesAdded < -1 ? "s" : ""}`
        : "creates no holes";
  return `Rotation ${c.rot}, ${cols}, lands ${f.landsAt} row${f.landsAt > 1 ? "s" : ""} above the floor; ${lines}, ${holesText}; stack height after: ${f.stackHeight}, bumpiness after: ${f.bumpiness}.`;
}

/** Option id → plain-language description, in the order the engine listed them. */
export function optionDescriptions(req: DecisionRequest): Record<string, string> {
  const board = decodeBoard(req.board);
  return Object.fromEntries(req.candidates.map((c) => [c.id, describeCandidate(candidateFeatures(board, req.type, c), c)]));
}

function columnHeights(b: Board): number[] {
  const heights: number[] = [];
  for (let x = 0; x < WIDTH; x++) {
    let h = 0;
    for (let y = 0; y < HEIGHT; y++) {
      if (b[y * WIDTH + x] !== ".") {
        h = HEIGHT - y;
        break;
      }
    }
    heights.push(h);
  }
  return heights;
}

function holes(b: Board): number {
  let n = 0;
  for (let x = 0; x < WIDTH; x++) {
    let roof = false;
    for (let y = 0; y < HEIGHT; y++) {
      if (b[y * WIDTH + x] !== ".") roof = true;
      else if (roof) n++;
    }
  }
  return n;
}
