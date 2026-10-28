import { describe, expect, it } from "bun:test";
import { compareStandings, type Standing } from "./ranking";

const board = (s: Partial<Standing>): Standing => ({ landed: 0, lines: 0, pieces: 0, outAt: null, reachedGoal: false, ...s });
const order = (boards: Standing[], mode: "realtime" | "frozen", targetLines: number) =>
  [...boards].sort((a, b) => compareStandings(a, b, { mode, targetLines })).map((b) => boards.indexOf(b));

describe("compareStandings", () => {
  it("ranks by pieces landed, then lines, then time survived", () => {
    const boards = [
      board({ landed: 50, lines: 9, outAt: 80 }),
      board({ landed: 60, lines: 5, outAt: 40 }),
      board({ landed: 50, lines: 9, outAt: 90 }),
    ];
    expect(order(boards, "realtime", 0)).toEqual([1, 2, 0]);
  });

  it("puts the first board to the target ahead in a real-time sprint", () => {
    const boards = [
      board({ reachedGoal: true, outAt: 90_000, pieces: 95 }),
      board({ lines: 38, landed: 200, outAt: 120_000 }),
      board({ reachedGoal: true, outAt: 70_000, pieces: 110 }),
    ];
    expect(order(boards, "realtime", 40)).toEqual([2, 0, 1]);
  });

  it("uses pieces, not time, for a frozen-clock sprint", () => {
    const boards = [board({ reachedGoal: true, outAt: 300_000, pieces: 98 }), board({ reachedGoal: true, outAt: 60_000, pieces: 120 })];
    expect(order(boards, "frozen", 40)).toEqual([0, 1]);
  });

  it("never breaks a frozen-clock survive tie by time", () => {
    const a = board({ landed: 50, lines: 9, pieces: 60, outAt: 40_000 });
    const b = board({ landed: 50, lines: 9, pieces: 60, outAt: 90_000 });
    expect(compareStandings(a, b, { mode: "frozen", targetLines: 0 })).toBe(0);
  });

  it("ranks a frozen-clock survive tie by pieces placed, the board that lasted longer first", () => {
    const fewer = board({ landed: 50, lines: 9, pieces: 40, outAt: 90_000 });
    const more = board({ landed: 50, lines: 9, pieces: 60, outAt: 40_000 });
    expect(compareStandings(more, fewer, { mode: "frozen", targetLines: 0 })).toBeLessThan(0);
    expect(order([fewer, more], "frozen", 0)).toEqual([1, 0]);
  });

  it("still breaks a real-time tie by time survived", () => {
    const early = board({ landed: 50, lines: 9, pieces: 60, outAt: 40_000 });
    const late = board({ landed: 50, lines: 9, pieces: 60, outAt: 90_000 });
    expect(order([early, late], "realtime", 0)).toEqual([1, 0]);
  });

  it("ranks boards that fell short by lines", () => {
    const boards = [board({ lines: 20, landed: 90 }), board({ lines: 31, landed: 70 })];
    expect(order(boards, "realtime", 40)).toEqual([1, 0]);
  });
});
