// Sends one real decision to every configured live model and prints what came back.
//   bun scripts/smoke.ts
import { TetrisGame } from "../src/engine/game";
import { encodeBoard } from "../src/engine/board";
import { DEFAULT_CONFIG, type DecisionAnswer, type DecisionRequest, type RunConfig } from "../src/arena/types";
import { createSource, listSources } from "../server/sources/registry";

const game = new TetrisGame(1);
game.spawn();
const req: DecisionRequest = {
  agentId: "smoke",
  pieceId: 1,
  type: game.active!.type,
  board: encodeBoard(game.board),
  next: game.preview,
  candidates: game.candidates().map(({ id, rot, x, y, cells }) => ({ id, rot, x, y, cells })),
  level: 1,
  mode: "realtime",
  deadlineMs: 20_000,
  requestedAt: 0,
};

const live = listSources().filter((s) => s.live);
const run: RunConfig = {
  ...DEFAULT_CONFIG,
  seed: 1,
  mode: "realtime",
  agents: live.map((s) => ({ id: s.id, name: s.label, kind: s.kind, sourceId: s.id })),
};

console.log(`${req.candidates.length} options for a ${req.type} piece\n`);
for (const s of live) {
  if (!s.available) {
    console.log(`${s.label}: skipped, ${s.reason}`);
    continue;
  }
  const spec = run.agents.find((a) => a.sourceId === s.id)!;
  await new Promise<void>((done) => {
    createSource(run, spec).request(
      req,
      (answer: DecisionAnswer, _at: number, latencyMs?: number) => {
        const p = answer.choice && answer.probabilities ? ` (p=${answer.probabilities[answer.choice]?.toFixed(2)})` : "";
        console.log(`${s.label.padEnd(18)} ${answer.status.padEnd(7)} ${String(Math.round(latencyMs ?? 0)).padStart(6)} ms  ${answer.choice ?? ""}${p}`);
        if (answer.detail) console.log(`${"".padEnd(19)}${answer.detail}`);
        if (answer.usage) console.log(`${"".padEnd(19)}tokens in ${answer.usage.inputTokens}, out ${answer.usage.outputTokens}`);
        done();
      },
      { now: () => 0, signal: new AbortController().signal },
    );
  });
}
