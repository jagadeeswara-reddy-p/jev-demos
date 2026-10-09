import type { Cell, PieceType } from "./pieces";

export const WIDTH = 10;
export const VISIBLE_HEIGHT = 20;
// Two hidden rows above the visible field, where pieces spawn.
export const HIDDEN_ROWS = 2;
export const HEIGHT = VISIBLE_HEIGHT + HIDDEN_ROWS;

// Each cell holds "." for empty or the letter of the piece that filled it.
export type Board = string[];

export function emptyBoard(): Board {
  return new Array(WIDTH * HEIGHT).fill(".");
}

export function cellAt(board: Board, x: number, y: number): string {
  return board[y * WIDTH + x];
}

export function fits(board: Board, cells: readonly Cell[]): boolean {
  for (const [x, y] of cells) {
    if (x < 0 || x >= WIDTH || y >= HEIGHT) return false;
    if (y >= 0 && board[y * WIDTH + x] !== ".") return false;
  }
  return true;
}

export function place(board: Board, cells: readonly Cell[], type: PieceType): Board {
  const next = board.slice();
  for (const [x, y] of cells) if (y >= 0) next[y * WIDTH + x] = type;
  return next;
}

export function fullRows(board: Board): number[] {
  const rows: number[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    let full = true;
    for (let x = 0; x < WIDTH; x++) {
      if (board[y * WIDTH + x] === ".") {
        full = false;
        break;
      }
    }
    if (full) rows.push(y);
  }
  return rows;
}

export function clearRows(board: Board, rows: readonly number[]): Board {
  if (rows.length === 0) return board;
  const remove = new Set(rows);
  const kept: string[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    if (!remove.has(y)) kept.push(...board.slice(y * WIDTH, (y + 1) * WIDTH));
  }
  return [...new Array(rows.length * WIDTH).fill("."), ...kept];
}

export function encodeBoard(board: Board): string {
  return board.join("");
}

export function decodeBoard(encoded: string): Board {
  return encoded.split("");
}
