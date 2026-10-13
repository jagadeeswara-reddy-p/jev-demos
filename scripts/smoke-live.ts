// One real full-size decision (first piece of seed 1, every landing spot as an
// option) through the arena's own adapter for a System One source.
// Usage: bun scripts/smoke-live.ts <jev|laya|gemma|clef> [repeats]
import type { DecisionAnswer, DecisionRequest, DecisionSource } from "../src/arena/types";
import { encodeBoard } from "../src/engine/board";
import { TetrisGame } from "../src/engine/game";
import { clefSource, gemmaSource, jevSource, layaSource } from "../server/sources/jev";

const SOURCES: Record<string, () => DecisionSource> = { jev: jevSource, laya: layaSource, gemma: gemmaSource, clef: clefSource };
const name = process.argv[2] ?? "";
const repeats = Number(process.argv[3] ?? 5);
if (!SOURCES[name]) throw new Error(`Usage: bun scripts/smoke-live.ts <${Object.keys(SOURCES).join("|")}> [repeats]`);

const game = new TetrisGame(1);
game.spawn();
const req: DecisionRequest = {
  agentId: "smoke",
  pieceId: game.pieceId,
  type: game.active!.type,
  board: encodeBoard(game.board),
  next: game.preview,
  candidates: game.candidates().map(({ id, rot, x, y, cells }) => ({ id, rot, x, y, cells })),
  level: 1,
  mode: "frozen",
  deadlineMs: 30_000,
  requestedAt: 0,
};
const source = SOURCES[name]();
const times: number[] = [];
for (let i = 0; i < repeats; i++) {
  const t = performance.now();
  const a = await new Promise<DecisionAnswer>((resolve) => source.request(req, (ans) => resolve(ans), { now: () => 0, signal: new AbortController().signal }));
  times.push(Math.round(performance.now() - t));
  if (i === 0 || a.status !== "ok") {
    const top = a.probabilities ? Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, p]) => `${k} ${(p * 100).toFixed(1)}%`).join(", ") : "-";
    console.log(`${name}: ${req.candidates.length} options -> status ${a.status}, choice ${a.choice ?? "-"}, confidence ${a.confidence ?? "-"}`);
    console.log(`  top: ${top}`);
    console.log(`  usage ${JSON.stringify(a.usage)}${a.detail ? `\n  detail: ${a.detail}` : ""}`);
  }
}
const sorted = [...times].sort((a, b) => a - b);
console.log(`  round trips (ms): ${times.join(", ")}  median ${sorted[Math.floor(sorted.length / 2)]}`);
