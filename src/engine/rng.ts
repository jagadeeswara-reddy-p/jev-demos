import { PIECE_TYPES, type PieceType } from "./pieces";

export type Rng = () => number;

// mulberry32: tiny, fast, and fully deterministic for a given 32-bit seed.
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Derive independent streams (pieces, per-agent latency, ...) from one run seed.
export function deriveSeed(seed: number, salt: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < salt.length; i++) {
    h = Math.imul(h ^ salt.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}

// Guideline "7-bag": every run of 7 pieces contains each piece exactly once.
export class BagRandomizer {
  private rng: Rng;
  private bag: PieceType[] = [];

  constructor(seed: number) {
    this.rng = createRng(seed);
  }

  next(): PieceType {
    if (this.bag.length === 0) {
      const bag = [...PIECE_TYPES];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      this.bag = bag;
    }
    return this.bag.shift()!;
  }
}
