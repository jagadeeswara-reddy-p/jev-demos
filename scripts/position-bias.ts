// Does a decision model pick by what an option says, or by where it is listed?
// Asks the same boards several times with the options in a different order each
// time, by reordering the `criteria` object itself, so it works on any Decisions
// API server whether or not it supports `option_order`.
//
//   bun scripts/position-bias.ts live-laya live-strands live-jev [--states 12] [--shuffles 6] [--rotations N]
//
// Each request is the one the arena sends, including the model's `rotations`
// (or --rotations N for all of them; 1 turns rotations off).
//
// Per model it reports:
//   first 2 slots  share of picks that were one of the first two options as listed
//                  (choosing by content alone gives about 2 / options, ~8% here)
//   same pick      for each board, how often the model picked its most common answer
//                  across the orders (100% = the order made no difference)
//   best move      share of picks that were the reference heuristic's top option
import type { DecisionRequest } from "../src/arena/types";
import { encodeBoard } from "../src/engine/board";
import { TetrisGame } from "../src/engine/game";
import { evaluatePlacement } from "../src/engine/heuristic";
import { createRng } from "../src/engine/rng";
import { decisionBody, readDecision } from "../server/adapters/decision";
import { bearer } from "../server/adapters/shared";
import type { ModelConfig } from "../server/models/types";
import { models } from "../server/sources";

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args.splice(i, 2)[1]) || fallback : fallback;
};
const STATES = flag("--states", 12);
/** Overrides each model's own rotations setting; 0 keeps it. */
const ROTATIONS = flag("--rotations", 0);
const SHUFFLES = flag("--shuffles", 6);
const ids = args;
if (!ids.length) throw new Error("Usage: bun scripts/position-bias.ts <model-id>... [--states 12] [--shuffles 6]");

/** Boards from a seeded game played by the heuristic, mostly its best move with every fourth its third best, so stacks get some shape. */
function boards(count: number): { req: DecisionRequest; ranks: Map<string, number> }[] {
  const game = new TetrisGame(7);
  const out: { req: DecisionRequest; ranks: Map<string, number> }[] = [];
  for (let piece = 1; out.length < count && game.spawn(); piece++) {
    const cands = game.candidates();
    const scored = cands.map((c) => ({ c, s: evaluatePlacement(game.board, game.active!.type, c) })).sort((a, b) => b.s - a.s);
    if (piece % 3 === 0 && cands.length >= 9) {
      out.push({
        req: {
          agentId: "bias",
          pieceId: piece,
          type: game.active!.type,
          board: encodeBoard(game.board),
          next: game.preview,
          candidates: cands.map(({ id, rot, x, y, cells }) => ({ id, rot, x, y, cells })),
          level: 1,
          mode: "frozen",
          deadlineMs: 30_000,
          requestedAt: 0,
        },
        ranks: new Map(scored.map((e, i) => [e.c.id, i + 1])),
      });
    }
    const pick = scored[piece % 4 === 0 ? Math.min(2, scored.length - 1) : 0].c;
    game.applyPlacement(pick, "place");
  }
  return out;
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function ask(model: ModelConfig, req: DecisionRequest, order: string[]) {
  // The same request the arena sends (rotations included), with the options listed in `order`.
  const byId = new Map(req.candidates.map((c) => [c.id, c]));
  const listed = { ...req, candidates: order.map((id) => byId.get(id)!) };
  const started = performance.now();
  const res = await fetch(model.url ?? `${model.baseUrl}/v1/systemone`, {
    method: "POST",
    headers: { ...bearer(model.apiKey), "Content-Type": "application/json" },
    body: JSON.stringify(decisionBody(model, listed)),
    signal: AbortSignal.timeout(model.timeoutMs ?? 30_000),
  });
  const ms = performance.now() - started;
  if (!res.ok) throw new Error(`${model.label} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { answer: readDecision(model, await res.json()), ms };
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "-");
const set = boards(STATES);
const avgOptions = set.reduce((s, b) => s + b.req.candidates.length, 0) / set.length;
console.log(`${set.length} boards x ${SHUFFLES} orders, ${avgOptions.toFixed(1)} options on average (first two by chance: ${pct(2, avgOptions)})\n`);
console.log(`${"model".padEnd(24)} ${"first 2 slots".padStart(13)} ${"same pick".padStart(10)} ${"best move".padStart(10)} ${"median".padStart(8)}`);

for (const id of ids) {
  const configured = models.resolve(id);
  const model = ROTATIONS ? { ...configured, rotations: ROTATIONS } : configured;
  if (model.adapter !== "decision") throw new Error(`${id} isn't a decision model`);
  const rand = createRng(42);
  let picks = 0,
    firstTwo = 0,
    best = 0,
    same = 0;
  const times: number[] = [];
  for (const { req, ranks } of set) {
    const listed = req.candidates.map((c) => c.id);
    const counts = new Map<string, number>();
    for (let k = 0; k < SHUFFLES; k++) {
      const order = k === 0 ? listed : shuffled(listed, rand);
      const { answer, ms } = await ask(model, req, order);
      times.push(ms);
      if (answer.status !== "ok" || !answer.choice) continue;
      picks++;
      if (order.indexOf(answer.choice) < 2) firstTwo++;
      if (ranks.get(answer.choice) === 1) best++;
      counts.set(answer.choice, (counts.get(answer.choice) ?? 0) + 1);
    }
    same += Math.max(0, ...counts.values());
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  console.log(
    `${`${model.label}${(model.rotations ?? 1) > 1 ? ` (x${model.rotations})` : ""}`.padEnd(24)} ${pct(firstTwo, picks).padStart(13)} ${pct(same, picks).padStart(10)} ${pct(best, picks).padStart(10)} ${`${Math.round(median)} ms`.padStart(8)}`,
  );
}
