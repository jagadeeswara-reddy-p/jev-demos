// One real request to Cloudflare Clef, printed raw, to check credentials and the
// response shape the adapter reads. Usage: bun scripts/smoke-clef.ts
// Then one decision through the arena's own adapter on a real board.
import { config } from "../server/config";
import { clefSource } from "../server/sources/jev";
import type { DecisionAnswer, DecisionRequest } from "../src/arena/types";
import { encodeBoard } from "../src/engine/board";
import { TetrisGame } from "../src/engine/game";

const c = config.clef;
if (!c.accountId || !c.apiToken) throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env");
const url = `https://api.cloudflare.com/client/v4/accounts/${c.accountId}/ai/run/@cf/cloudflare/clef`;

console.log(`1. Raw probe, model ${c.model}`);
const t0 = performance.now();
const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: `Bearer ${c.apiToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: c.model,
    state: "A Tetris board, 10 wide. The stack is flat except a one-wide gap in column 9, four rows deep. The falling piece is an I.",
    questions: {
      placement: {
        type: "choice",
        instructions: "Pick where to drop the piece to clear the most lines.",
        criteria: { option_1: "vertical I into the gap at column 9", option_2: "flat I on the left side", option_3: "vertical I at column 0" },
      },
    },
  }),
});
console.log(`   HTTP ${res.status} in ${Math.round(performance.now() - t0)} ms`);
console.log(JSON.stringify(await res.json(), null, 2));

console.log(`\n2. One full decision through the adapter (first piece of seed 1)`);
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
const t1 = performance.now();
const answer = await new Promise<DecisionAnswer>((resolve) => clefSource().request(req, (a) => resolve(a), { now: () => 0, signal: new AbortController().signal }));
console.log(`   ${req.candidates.length} options, answered in ${Math.round(performance.now() - t1)} ms`);
console.log(`   status ${answer.status}, choice ${answer.choice ?? "-"}, confidence ${answer.confidence ?? "-"}`);
console.log(`   usage ${JSON.stringify(answer.usage)}${answer.detail ? `, detail: ${answer.detail}` : ""}`);
