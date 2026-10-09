export type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
export type Cell = readonly [x: number, y: number];

export const PIECE_TYPES: readonly PieceType[] = ["I", "J", "L", "O", "S", "T", "Z"];

// Spawn orientation of each piece inside its SRS bounding box (y grows downward).
const SPAWN: Record<PieceType, { size: number; cells: Cell[] }> = {
  I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};

function rotateCw(cells: Cell[], size: number): Cell[] {
  return cells.map(([x, y]) => [size - 1 - y, x] as const);
}

// SHAPES[type][rotation] -> cells relative to the piece origin (top-left of its box).
export const SHAPES: Record<PieceType, Cell[][]> = Object.fromEntries(
  PIECE_TYPES.map((type) => {
    const { size, cells } = SPAWN[type];
    const rotations: Cell[][] = [cells];
    for (let r = 1; r < 4; r++) rotations.push(rotateCw(rotations[r - 1], size));
    return [type, rotations];
  }),
) as Record<PieceType, Cell[][]>;

export function pieceCells(type: PieceType, rot: number, x: number, y: number): Cell[] {
  return SHAPES[type][rot & 3].map(([cx, cy]) => [x + cx, y + cy] as const);
}

// Pieces spawn centred, with O nudged so it sits in columns 4-5 like the guideline.
export function spawnX(type: PieceType, width: number): number {
  return type === "O" ? Math.floor(width / 2) - 1 : Math.floor(width / 2) - 2;
}
