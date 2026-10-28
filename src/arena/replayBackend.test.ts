import { describe, expect, test } from "bun:test";
import { fromJsonl, toJsonl } from "./replayBackend";
import { mockLineup, runMockLineup } from "./testRuns";

describe("fromJsonl", () => {
  test("loads a new log, episode_finished included", () => {
    const events = runMockLineup(mockLineup("realtime", 1));
    expect(events.some((e) => e.t === "episode_finished")).toBe(true);
    expect(fromJsonl(toJsonl(events))).toHaveLength(events.length);
  });
});
