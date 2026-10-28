import { expect, test } from "bun:test";
import { logDigest, mockLineup, runMockLineup } from "./testRuns";

// Mock runs must replay byte for byte across refactors. UPDATE_GOLDEN=1 rewrites
// the fixture; only do that for a change that is meant to alter the game.

const FIXTURE = `${import.meta.dir}/__golden__/runs.json`;

test("mock run logs match the golden digests", async () => {
  const actual: Record<string, { events: number; sha256: string }> = {};
  for (const mode of ["realtime", "frozen"] as const) {
    for (const seed of [1, 2]) actual[`${mode}-seed${seed}`] = logDigest(runMockLineup(mockLineup(mode, seed)));
  }
  if (Bun.env.UPDATE_GOLDEN === "1") await Bun.write(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
  expect(actual).toEqual(await Bun.file(FIXTURE).json());
});
