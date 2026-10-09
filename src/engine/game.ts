import {
  HEIGHT,
  HIDDEN_ROWS,
  WIDTH,
  clearRows,
  emptyBoard,
  fits,
  fullRows,
  place,
  type Board,
} from "./board";
import { pieceCells, spawnX, type Cell, type PieceType } from "./pieces";
import { BagRandomizer } from "./rng";

export interface ActivePiece {
  type: PieceType;
  rot: number;
  x: number;
  y: number;
}

// One legal landing spot for the active piece: what a model chooses between.
export interface Candidate {
  id: string;
  rot: number;
  x: number;
  y: number;
  cells: Cell[];
}

export interface LockResult {
  type: PieceType;
  cells: Cell[];
  rows: number[];
  toppedOut: boolean;
  byDecision: boolean;
}

export const MAX_LEVEL = 20;

// Guideline (Tetris Worlds) speed curve: seconds per row = (0.8 - (L-1) * 0.007)^(L-1).
export function gravityMsPerRow(level: number): number {
  const l = Math.min(Math.max(level, 1), MAX_LEVEL);
  return 1000 * Math.pow(0.8 - (l - 1) * 0.007, l - 1);
}

export class TetrisGame {
  board: Board = emptyBoard();
  active: ActivePiece | null = null;
  queue: PieceType[] = [];
  lines = 0;
  pieces = 0;
  pieceId = 0;
  toppedOut = false;

  private bag: BagRandomizer;
  private fallAccum = 0;
  private lockAccum = 0;

  constructor(seed: number, private previewCount = 3) {
    this.bag = new BagRandomizer(seed);
    for (let i = 0; i < previewCount + 1; i++) this.queue.push(this.bag.next());
  }

  get preview(): PieceType[] {
    return this.queue.slice(0, this.previewCount);
  }

  /** Spawns the next piece. Returns false (and tops out) when the spawn spot is blocked. */
  spawn(): boolean {
    const type = this.queue.shift()!;
    this.queue.push(this.bag.next());
    // Spawn with the piece's top row on the first visible row, so it is seen before it moves.
    const top = Math.min(...pieceCells(type, 0, 0, 0).map(([, cy]) => cy));
    const piece = { type, rot: 0, x: spawnX(type, WIDTH), y: HIDDEN_ROWS - top };
    this.pieceId += 1;
    this.fallAccum = 0;
    this.lockAccum = 0;
    if (!fits(this.board, pieceCells(type, 0, piece.x, piece.y))) {
      this.active = null;
      this.toppedOut = true;
      return false;
    }
    this.active = piece;
    return true;
  }

  activeCells(): Cell[] {
    const a = this.active;
    return a ? pieceCells(a.type, a.rot, a.x, a.y) : [];
  }

  /** Applies gravity for `dtMs`. Locks the piece once it has rested for `lockDelayMs`. */
  advance(dtMs: number, gravityMs: number, lockDelayMs: number): { moved: boolean; lock: LockResult | null } {
    const a = this.active;
    if (!a) return { moved: false, lock: null };
    let moved = false;
    this.fallAccum += dtMs;
    while (this.fallAccum >= gravityMs) {
      if (fits(this.board, pieceCells(a.type, a.rot, a.x, a.y + 1))) {
        a.y += 1;
        moved = true;
        this.fallAccum -= gravityMs;
        this.lockAccum = 0;
      } else {
        this.fallAccum = 0;
        break;
      }
    }
    if (!fits(this.board, pieceCells(a.type, a.rot, a.x, a.y + 1))) {
      this.lockAccum += dtMs;
      if (this.lockAccum >= lockDelayMs) return { moved, lock: this.lock(false) };
    }
    return { moved, lock: null };
  }

  /** Time until the active piece would lock if nobody touches it. */
  msUntilLock(gravityMs: number, lockDelayMs: number): number {
    const a = this.active;
    if (!a) return 0;
    const rows = this.dropY(a.type, a.rot, a.x, a.y) - a.y;
    return Math.max(0, rows * gravityMs - this.fallAccum) + Math.max(0, lockDelayMs - this.lockAccum);
  }

  /** Every distinct landing spot reachable from where the active piece is right now. */
  candidates(): Candidate[] {
    const a = this.active;
    if (!a) return [];
    const seen = new Set<string>();
    const out: Candidate[] = [];
    for (let rot = 0; rot < 4; rot++) {
      if (!fits(this.board, pieceCells(a.type, rot, a.x, a.y))) continue;
      for (const dir of [-1, 1]) {
        for (let x = dir === -1 ? a.x : a.x + 1; ; x += dir) {
          if (!fits(this.board, pieceCells(a.type, rot, x, a.y))) break;
          const y = this.dropY(a.type, rot, x, a.y);
          const cells = pieceCells(a.type, rot, x, y);
          const key = cells
            .map(([cx, cy]) => cy * WIDTH + cx)
            .sort((p, q) => p - q)
            .join(",");
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ id: "", rot, x, y, cells });
          }
        }
      }
    }
    out.sort((p, q) => p.x - q.x || p.rot - q.rot);
    out.forEach((c, i) => (c.id = `option_${i + 1}`));
    return out;
  }

  /**
   * Moves the active piece to a chosen landing spot and locks it there.
   * Returns null when the spot can no longer be reached from the current position.
   */
  applyPlacement(target: { rot: number; x: number }): LockResult | null {
    const a = this.active;
    if (!a) return null;
    if (!fits(this.board, pieceCells(a.type, target.rot, a.x, a.y))) return null;
    const step = Math.sign(target.x - a.x);
    for (let x = a.x; x !== target.x; x += step) {
      if (!fits(this.board, pieceCells(a.type, target.rot, x + step, a.y))) return null;
    }
    a.rot = target.rot;
    a.x = target.x;
    a.y = this.dropY(a.type, a.rot, a.x, a.y);
    return this.lock(true);
  }

  /**
   * Puts the active piece straight onto a landing spot and locks it, as if the
   * inputs had been held while the model was thinking. Only checks the spot itself.
   */
  placeAt(target: { rot: number; x: number; y: number }): LockResult | null {
    const a = this.active;
    if (!a || !fits(this.board, pieceCells(a.type, target.rot, target.x, target.y))) return null;
    a.rot = target.rot;
    a.x = target.x;
    a.y = this.dropY(a.type, target.rot, target.x, target.y);
    return this.lock(true);
  }

  /** Drops the piece straight down from where it is and locks it. */
  hardDrop(): LockResult | null {
    const a = this.active;
    if (!a) return null;
    a.y = this.dropY(a.type, a.rot, a.x, a.y);
    return this.lock(false);
  }

  private dropY(type: PieceType, rot: number, x: number, y: number): number {
    while (fits(this.board, pieceCells(type, rot, x, y + 1))) y += 1;
    return y;
  }

  private lock(byDecision: boolean): LockResult {
    const a = this.active!;
    const cells = pieceCells(a.type, a.rot, a.x, a.y);
    let board = place(this.board, cells, a.type);
    const rows = fullRows(board);
    board = clearRows(board, rows);
    this.board = board;
    this.active = null;
    this.lines += rows.length;
    this.pieces += 1;
    // Lock out: anything left in the hidden rows above the field ends the game.
    const toppedOut = board.slice(0, HIDDEN_ROWS * WIDTH).some((c) => c !== ".");
    if (toppedOut) this.toppedOut = true;
    return { type: a.type, cells, rows, toppedOut, byDecision };
  }
}

export { HEIGHT, HIDDEN_ROWS, WIDTH };
