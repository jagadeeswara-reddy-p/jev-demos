import { type Board, clearRows, emptyBoard, fits, fullRows, HEIGHT, HIDDEN_ROWS, place, WIDTH } from "./board";
import { type Cell, type PieceType, pieceCells, spawnX } from "./pieces";
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
  return 1000 * (0.8 - (l - 1) * 0.007) ** (l - 1);
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
  /** Set while the piece falls to a spot it was steered to; it locks the moment it lands. */
  private dropping: { byDecision: boolean } | null = null;

  constructor(
    seed: number,
    private previewCount = 3,
  ) {
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
    this.dropping = null;
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

  get isDropping(): boolean {
    return this.dropping !== null;
  }

  /**
   * Moves the piece for `dtMs`. Normally that is gravity, locking once the piece
   * has rested for `lockDelayMs`. A piece that was steered or released instead
   * falls at `dropMsPerRow` (never slower than gravity) and locks as it lands;
   * 0 drops it instantly.
   */
  advance(dtMs: number, gravityMs: number, lockDelayMs: number, dropMsPerRow = 0): { moved: boolean; lock: LockResult | null } {
    const a = this.active;
    if (!a) return { moved: false, lock: null };
    if (this.dropping) return this.advanceDrop(dtMs, dropMsPerRow > 0 ? Math.min(dropMsPerRow, gravityMs) : 0);
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

  private advanceDrop(dtMs: number, msPerRow: number): { moved: boolean; lock: LockResult | null } {
    const a = this.active!;
    const byDecision = this.dropping!.byDecision;
    if (msPerRow === 0) {
      a.y = this.dropY(a.type, a.rot, a.x, a.y);
      return { moved: true, lock: this.lock(byDecision) };
    }
    let moved = false;
    this.fallAccum += dtMs;
    while (this.fallAccum >= msPerRow) {
      if (!fits(this.board, pieceCells(a.type, a.rot, a.x, a.y + 1))) break;
      a.y += 1;
      moved = true;
      this.fallAccum -= msPerRow;
    }
    if (!fits(this.board, pieceCells(a.type, a.rot, a.x, a.y + 1))) return { moved, lock: this.lock(byDecision) };
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
    for (const [i, c] of out.entries()) c.id = `option_${i + 1}`;
    return out;
  }

  /**
   * Turns and shifts the active piece over a chosen landing spot; `advance` then
   * drops it there. "place" lines it up directly above the spot, as if the inputs
   * had been held while the model was thinking. "path" requires the turn and the
   * sideways moves to be possible from where the piece is now. Returns false
   * (leaving the piece alone) when the spot can't be reached.
   */
  steer(target: { rot: number; x: number; y: number }, movement: "place" | "path" = "place"): boolean {
    const a = this.active;
    if (!a) return false;
    if (movement === "path") {
      if (!fits(this.board, pieceCells(a.type, target.rot, a.x, a.y))) return false;
      const step = Math.sign(target.x - a.x);
      for (let x = a.x; x !== target.x; x += step) {
        if (!fits(this.board, pieceCells(a.type, target.rot, x + step, a.y))) return false;
      }
    } else if (!fits(this.board, pieceCells(a.type, target.rot, target.x, target.y))) {
      return false;
    }
    // Fall from the current height when the column is open there, else from the spot itself.
    const fromHere = a.y <= target.y && fits(this.board, pieceCells(a.type, target.rot, target.x, a.y));
    a.rot = target.rot;
    a.x = target.x;
    if (!fromHere) a.y = target.y;
    this.fallAccum = 0;
    this.dropping = { byDecision: true };
    return true;
  }

  /** Lets the piece fall straight down from where it is, with no decision behind it. */
  release() {
    if (!this.active) return;
    this.fallAccum = 0;
    this.dropping = { byDecision: false };
  }

  /** Steers to a spot and drops it there at once. Returns null when the spot can't be reached. */
  applyPlacement(target: { rot: number; x: number; y: number }, movement: "place" | "path" = "path"): LockResult | null {
    return this.steer(target, movement) ? this.advanceDrop(0, 0).lock : null;
  }

  /** Drops the piece straight down from where it is and locks it. */
  hardDrop(): LockResult | null {
    if (!this.active) return null;
    this.release();
    return this.advanceDrop(0, 0).lock;
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
