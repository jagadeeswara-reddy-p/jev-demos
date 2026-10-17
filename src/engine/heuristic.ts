import { type Board, clearRows, fullRows, HEIGHT, place, WIDTH } from "./board";
import type { Candidate } from "./game";
import type { PieceType } from "./pieces";

// Pierre Dellacherie's hand-tuned weights, the classic one-piece Tetris evaluator.
const W = {
  landingHeight: -4.500158825082766,
  erodedCells: 3.4181268101392694,
  rowTransitions: -3.2178882868487753,
  colTransitions: -9.348695305445199,
  holes: -7.899265427351652,
  wells: -3.3855972247263626,
};

const filled = (b: Board, x: number, y: number) => x < 0 || x >= WIDTH || y >= HEIGHT || (y >= 0 && b[y * WIDTH + x] !== ".");

/** Scores the board that would result from placing `type` at `candidate`. Higher is better. */
export function evaluatePlacement(board: Board, type: PieceType, candidate: Candidate): number {
  const placed = place(board, candidate.cells, type);
  const rows = fullRows(placed);
  const after = clearRows(placed, rows);

  const ys = candidate.cells.map(([, y]) => y);
  const landingHeight = HEIGHT - (Math.min(...ys) + Math.max(...ys)) / 2;
  const pieceCellsCleared = candidate.cells.filter(([, y]) => rows.includes(y)).length;
  const erodedCells = rows.length * pieceCellsCleared;

  let rowTransitions = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = -1; x < WIDTH; x++) {
      if (filled(after, x, y) !== filled(after, x + 1, y)) rowTransitions++;
    }
  }

  let colTransitions = 0;
  let holes = 0;
  for (let x = 0; x < WIDTH; x++) {
    let seenBlock = false;
    for (let y = 0; y < HEIGHT; y++) {
      const f = filled(after, x, y);
      if (f !== filled(after, x, y + 1)) colTransitions++;
      if (f) seenBlock = true;
      else if (seenBlock) holes++;
    }
  }

  let wells = 0;
  for (let x = 0; x < WIDTH; x++) {
    let depth = 0;
    for (let y = 0; y < HEIGHT; y++) {
      if (!filled(after, x, y) && filled(after, x - 1, y) && filled(after, x + 1, y)) {
        depth++;
        wells += depth;
      } else {
        depth = 0;
      }
    }
  }

  return (
    W.landingHeight * landingHeight +
    W.erodedCells * erodedCells +
    W.rowTransitions * rowTransitions +
    W.colTransitions * colTransitions +
    W.holes * holes +
    W.wells * wells
  );
}

/** Turns scores into a probability per option; lower temperature means a sharper, better player. */
export function softmax(scores: number[], temperature: number): number[] {
  if (!Number.isFinite(temperature)) return scores.map(() => 1 / scores.length);
  if (temperature <= 0) {
    const best = scores.indexOf(Math.max(...scores));
    return scores.map((_, i) => (i === best ? 1 : 0));
  }
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / temperature));
  const sum = exps.reduce((p, q) => p + q, 0);
  return exps.map((e) => e / sum);
}
