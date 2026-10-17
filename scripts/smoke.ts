// Sends real decisions (first piece of seed 1, every landing spot as an option)
// to configured models and prints what came back, the same check as the page's Test button.
//   bun scripts/smoke.ts                       every model that can run, once
//   bun scripts/smoke.ts live-laya live-jev -n 5   these models, five times each
import { sampleRequest, testModel } from "../server/sample";
import { models } from "../server/sources";

const args = process.argv.slice(2);
const n = args.indexOf("-n");
const repeats = n >= 0 ? Math.max(1, Number(args.splice(n, 2)[1]) || 1) : 1;
const ids = args.length ? args : models.list().map((m) => m.id);
const req = sampleRequest();

console.log(`${req.candidates.length} options for a ${req.type} piece\n`);
for (const id of ids) {
  const info = models.get(id);
  if (!info) {
    console.log(`${id}: no such model`);
    continue;
  }
  if (!info.available) {
    console.log(`${info.label}: skipped, ${info.reason}`);
    continue;
  }
  const model = models.resolve(id);
  const times: number[] = [];
  for (let i = 0; i < repeats; i++) {
    const r = await testModel(model, req);
    times.push(r.latencyMs);
    if (i > 0 && r.status === "ok") continue;
    const top = r.probabilities
      ? Object.entries(r.probabilities)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, p]) => `${k} ${(p * 100).toFixed(1)}%`)
          .join(", ")
      : "";
    console.log(
      `${info.label.padEnd(18)} ${r.status.padEnd(7)} ${String(r.latencyMs).padStart(6)} ms  ${r.choice ?? ""}${top ? `  (top: ${top})` : ""}`,
    );
    if (r.detail) console.log(`${"".padEnd(19)}${r.detail}`);
    if (r.usage) console.log(`${"".padEnd(19)}tokens in ${r.usage.inputTokens}, out ${r.usage.outputTokens}, $${r.usage.costUsd.toPrecision(2)}`);
  }
  if (repeats > 1) {
    const sorted = [...times].sort((a, b) => a - b);
    console.log(`${"".padEnd(19)}round trips (ms): ${times.join(", ")}, median ${sorted[Math.floor(sorted.length / 2)]}`);
  }
}
