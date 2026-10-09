import { describe, expect, it } from "bun:test";
import { HEIGHT, WIDTH, emptyBoard, fullRows } from "./board";
import { TetrisGame, gravityMsPerRow } from "./game";
import { evaluatePlacement, softmax } from "./heuristic";
import { PIECE_TYPES, SHAPES } from "./pieces";
import { BagRandomizer } from "./rng";

describe("pieces", () => {
  it("has four cells in every rotation", () => {
    for (const t of PIECE_TYPES) for (const r of SHAPES[t]) expect(r).toHaveLength(4);
  });
});

describe("7-bag randomizer", () => {
  it("is deterministic per seed and deals each piece once per bag", () => {
    const a = new BagRandomizer(42);
    const b = new BagRandomizer(42);
    const seqA = Array.from({ length: 21 }, () => a.next());
    const seqB = Array.from({ length: 21 }, () => b.next());
    expect(seqA).toEqual(seqB);
    for (let i = 0; i < 21; i += 7) expect(new Set(seqA.slice(i, i + 7)).size).toBe(7);
  });
});

describe("gravity curve", () => {
  it("matches the guideline formula", () => {
    expect(gravityMsPerRow(1)).toBeCloseTo(1000);
    expect(gravityMsPerRow(15)).toBeCloseTo(7.05, 1);
    expect(gravityMsPerRow(99)).toBe(gravityMsPerRow(20));
  });
});

describe("TetrisGame", () => {
  it("offers distinct landing spots for the active piece", () => {
    const g = new TetrisGame(1);
    g.spawn();
    const c = g.candidates();
    expect(c.length).toBeGreaterThan(5);
    expect(new Set(c.map((x) => x.id)).size).toBe(c.length);
    for (const cand of c) for (const [x, y] of cand.cells) expect(x >= 0 && x < WIDTH && y < HEIGHT).toBe(true);
  });

  it("locks a chosen placement on the floor", () => {
    const g = new TetrisGame(1);
    g.spawn();
    const [first] = g.candidates();
    const lock = g.applyPlacement(first)!;
    expect(lock.byDecision).toBe(true);
    expect(Math.max(...lock.cells.map(([, y]) => y))).toBe(HEIGHT - 1);
    expect(g.pieces).toBe(1);
  });

  it("locks by gravity after the lock delay", () => {
    const g = new TetrisGame(1);
    g.spawn();
    let lock = null;
    for (let t = 0; t < 60_000 && !lock; t += 16) lock = g.advance(16, 50, 500).lock;
    expect(lock?.byDecision).toBe(false);
  });

  it("is the same game for two players with the same seed", () => {
    const a = new TetrisGame(7);
    const b = new TetrisGame(7);
    for (let i = 0; i < 10; i++) {
      a.spawn();
      b.spawn();
      expect(a.active!.type).toBe(b.active!.type);
      a.hardDrop();
      b.hardDrop();
    }
  });

  it("tops out when nobody steers", () => {
    const g = new TetrisGame(3);
    let pieces = 0;
    while (g.spawn() && pieces < 200) {
      pieces++;
      if (g.hardDrop()!.toppedOut) break;
    }
    expect(g.toppedOut).toBe(true);
  });

  it("clears lines when the heuristic plays", () => {
    const g = new TetrisGame(11);
    for (let i = 0; i < 120 && g.spawn(); i++) {
      const cands = g.candidates();
      const scores = cands.map((c) => evaluatePlacement(g.board, g.active!.type, c));
      const best = cands[scores.indexOf(Math.max(...scores))];
      if (g.applyPlacement(best)!.toppedOut) break;
    }
    expect(g.toppedOut).toBe(false);
    expect(g.lines).toBeGreaterThan(30);
  });
});

describe("board", () => {
  it("finds no full rows on an empty board", () => {
    expect(fullRows(emptyBoard())).toEqual([]);
  });
});

describe("softmax", () => {
  it("sums to one and handles argmax and uniform", () => {
    expect(softmax([1, 2, 3], 1).reduce((p, q) => p + q)).toBeCloseTo(1);
    expect(softmax([1, 5, 3], 0)).toEqual([0, 1, 0]);
    expect(softmax([1, 5], Infinity)).toEqual([0.5, 0.5]);
  });
});
