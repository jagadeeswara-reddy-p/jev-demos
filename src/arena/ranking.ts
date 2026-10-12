import type { ClockMode } from "./types";

// Who won a run. Shared by the results chart and `bun stats`, so both always agree.
//
// Default: most pieces landed (each model's own in-time placements), then lines,
// then time survived.
// Sprint (a line target is set): boards that reached the target come first,
// ordered by time on the real-time clock or by pieces used on the frozen clock,
// where time mostly measures waiting. Boards that fell short follow, by lines.

export interface Standing {
  landed: number;
  lines: number;
  pieces: number;
  /** When the board stopped (topped out, survived or reached the target); null if still playing. */
  outAt: number | null;
  reachedGoal: boolean;
}

export interface RankRules {
  mode: ClockMode;
  targetLines: number;
}

export function compareStandings(a: Standing, b: Standing, rules: RankRules): number {
  const later = (b.outAt ?? Infinity) - (a.outAt ?? Infinity);
  if (rules.targetLines > 0) {
    if (a.reachedGoal !== b.reachedGoal) return a.reachedGoal ? -1 : 1;
    if (a.reachedGoal) {
      if (rules.mode === "frozen" && a.pieces !== b.pieces) return a.pieces - b.pieces;
      return (a.outAt ?? 0) - (b.outAt ?? 0);
    }
    if (a.lines !== b.lines) return b.lines - a.lines;
    if (a.landed !== b.landed) return b.landed - a.landed;
    return later;
  }
  if (a.landed !== b.landed) return b.landed - a.landed;
  if (a.lines !== b.lines) return b.lines - a.lines;
  return later;
}

/** One line on what decides the winner under these rules, for notes and README tables. */
export function winRule(rules: RankRules): string {
  if (rules.targetLines > 0) {
    return rules.mode === "frozen"
      ? `First to ${rules.targetLines} lines in the fewest pieces wins; boards that fall short rank by lines.`
      : `First to ${rules.targetLines} lines wins; boards that fall short rank by lines.`;
  }
  return "The board with the most pieces landed wins.";
}
