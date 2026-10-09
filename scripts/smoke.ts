// Sends one real decision to each configured live model and prints what came back.
//   bun scripts/smoke.ts
import { TetrisGame } from "../src/engine/game";
import { encodeBoard } from "../src/engine/board";
import type { DecisionAnswer, DecisionRequest } from "../src/arena/types";
import { jevSource } from "../server/sources/jev";
import { llmSource } from "../server/sources/llm";
import { listSources } from "../server/sources/registry";

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

function ask(name: string, source: ReturnType<typeof jevSource>) {
  return new Promise<void>((done) => {
    const controller = new AbortController();
    source.request(req, (answer: DecisionAnswer, _at: number, latencyMs?: number) => {
      const p = answer.choice && answer.probabilities ? ` (p=${answer.probabilities[answer.choice]?.toFixed(2)})` : "";
      console.log(`${name.padEnd(4)} ${answer.status.padEnd(7)} ${Math.round(latencyMs ?? 0)} ms  ${answer.choice ?? ""}${p}`);
      if (answer.detail) console.log(`     ${answer.detail}`);
      if (answer.usage) console.log(`     tokens in ${answer.usage.inputTokens}, out ${answer.usage.outputTokens}`);
      done();
    }, { now: () => 0, signal: controller.signal });
  });
}

console.log(`${req.candidates.length} options for a ${req.type} piece\n`);
const sources = listSources();
for (const s of sources.filter((s) => s.live && !s.available)) console.log(`${s.label}: skipped, ${s.reason}`);
if (sources.find((s) => s.id === "live-jev")?.available) await ask("Jev", jevSource());
if (sources.find((s) => s.id === "live-llm")?.available) await ask("LLM", llmSource());
