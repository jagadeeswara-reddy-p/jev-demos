import { describe, expect, test } from "bun:test";
import { mockSourceFor } from "../mock/mockSource";
import { tetris } from "./environment";
import { logDigest, mockLineup } from "./testRuns";

describe("tetris environment", () => {
  test("names itself and its variants", () => {
    expect(tetris.id).toBe("tetris");
    expect(tetris.version).toBe("1");
    expect(tetris.variants).toEqual(["described"]);
  });

  test("a match it creates plays exactly the golden run", async () => {
    const cfg = mockLineup("realtime", 1);
    const match = tetris.createMatch(
      cfg,
      cfg.agents.map((a) => mockSourceFor(cfg, a)),
    );
    const events = match.start();
    while (!match.finished) events.push(...match.step(1000));
    const golden = await Bun.file(`${import.meta.dir}/__golden__/runs.json`).json();
    expect(logDigest(events)).toEqual(golden["realtime-seed1"]);
  });
});
