// Statistics from saved run logs (runs/*.jsonl), per run and per model.
//
//   bun run stats                         all runs in runs/
//   bun run stats --since 2026-10-09T16:20 runs started at or after this UTC time
//   bun run stats --min-decisions 10      skip runs that were stopped almost at once
//   bun run stats --json out.json         also write the numbers as JSON
//   bun run stats runs/a.jsonl runs/b.jsonl
//
// Handles runs that were stopped early or cut off (no run_finished line).

import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { ArenaEvent, ArenaEventOf, RunConfig } from "../src/arena/types";

type Decision = ArenaEventOf<"decision">;

interface AgentStats {
  runId: string;
  mode: RunConfig["mode"];
  agentId: string;
  name: string;
  sourceId: string;
  outcome: "topped out" | "survived" | "still playing";
  outAt: number | null;
  level: number;
  lines: number;
  pieces: number;
  /** Pieces the model put where it chose, in time ("landed"). Most landed wins the run. */
  placedByDecision: number;
  fellWithoutDecision: number;
  status: Record<string, number>;
  /** Latency of every answer that came back (ok, late, invalid, blocked). */
  latencies: number[];
  /** For in-time answers: how much of the piece's deadline was left. */
  marginMs: number[];
  confidence: number[];
  chosenP: number[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface RunStats {
  id: string;
  seed: number;
  mode: RunConfig["mode"];
  durationMs: number;
  end: string;
  agents: AgentStats[];
  /** Name of the board with the most pieces landed (ties: lines, then time survived); null if nobody landed any. */
  winner: string | null;
}

// ---------- arguments ----------

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const since = flag("--since");
const minDecisions = Number(flag("--min-decisions") ?? 0);
const jsonOut = flag("--json");
const runsDir = Bun.env.RUNS_DIR ?? "runs";
const files = args.length
  ? args
  : readdirSync(runsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .map((f) => join(runsDir, f));

// ---------- per run ----------

async function analyse(path: string): Promise<RunStats | null> {
  const text = await Bun.file(path).text();
  const events = text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ArenaEvent);
  const start = events[0];
  if (start?.t !== "run_started") return null;
  const id = path.split("/").pop()!.replace(/\.jsonl$/, "");
  const config = start.config;
  const last = events.at(-1)!;

  const agents = new Map<string, AgentStats>();
  for (const a of config.agents) {
    agents.set(a.id, {
      runId: id,
      mode: config.mode,
      agentId: a.id,
      name: a.name,
      sourceId: a.sourceId,
      outcome: "still playing",
      outAt: null,
      level: config.startLevel,
      lines: 0,
      pieces: 0,
      placedByDecision: 0,
      fellWithoutDecision: 0,
      status: {},
      latencies: [],
      marginMs: [],
      confidence: [],
      chosenP: [],
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
  }

  let level = config.startLevel;
  const deadlines = new Map<string, number>(); // agentId:pieceId -> deadline
  for (const e of events) {
    if (e.t === "level") level = e.level;
    if (!("agentId" in e)) continue;
    const s = agents.get(e.agentId);
    if (!s) continue;
    if (s.outcome === "still playing") s.level = level;
    switch (e.t) {
      case "spawn":
        deadlines.set(`${e.agentId}:${e.pieceId}`, e.deadlineMs);
        break;
      case "decision":
        countDecision(s, e, deadlines.get(`${e.agentId}:${e.pieceId}`));
        break;
      case "lock":
        s.pieces += 1;
        s.lines += e.rows.length;
        if (e.byDecision) s.placedByDecision += 1;
        else s.fellWithoutDecision += 1;
        break;
      case "topout":
        s.outcome = "topped out";
        s.outAt = e.at;
        s.level = e.level;
        break;
      case "survived":
        s.outcome = "survived";
        s.outAt = e.at;
        s.level = e.level;
        break;
    }
  }

  const decisions = [...agents.values()].reduce((n, a) => n + Object.values(a.status).reduce((x, y) => x + y, 0), 0);
  if (decisions < minDecisions) return null;
  const list = [...agents.values()];
  return {
    id,
    seed: config.seed,
    mode: config.mode,
    durationMs: last.at,
    end: last.t === "run_finished" ? last.reason : "cut off",
    agents: list,
    winner: winnerOf(list),
  };
}

/** Most pieces landed wins; lines break ties, then time survived. */
function winnerOf(list: AgentStats[]): string | null {
  if (list.length < 2) return null;
  const ranked = [...list].sort(
    (a, b) =>
      b.placedByDecision - a.placedByDecision ||
      b.lines - a.lines ||
      (b.outAt ?? Infinity) - (a.outAt ?? Infinity),
  );
  const [first, second] = ranked;
  if (first.placedByDecision === 0) return null;
  const tie =
    first.placedByDecision === second.placedByDecision && first.lines === second.lines && first.outAt === second.outAt;
  return tie ? "tie" : first.name;
}

function countDecision(s: AgentStats, e: Decision, deadline: number | undefined) {
  s.status[e.status] = (s.status[e.status] ?? 0) + 1;
  if (e.status !== "error" && e.status !== "timeout") s.latencies.push(e.latencyMs);
  if (e.status === "ok" && deadline !== undefined) s.marginMs.push(deadline - e.latencyMs);
  if (e.confidence !== undefined) s.confidence.push(e.confidence);
  if (e.choice && e.probabilities?.[e.choice] !== undefined) s.chosenP.push(e.probabilities[e.choice]);
  if (e.usage) {
    s.inputTokens += e.usage.inputTokens;
    s.outputTokens += e.usage.outputTokens;
    s.costUsd += e.usage.costUsd;
  }
}

// ---------- helpers ----------

function pct(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const ms = (v: number | null) => (v === null ? "–" : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(2)} s`);
const secs = (v: number | null) => (v === null ? "–" : `${Math.round(v / 1000)} s`);
const num = (v: number | null, d = 2) => (v === null ? "–" : v.toFixed(d));
const usd = (v: number) => (v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
const share = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "–");
const answered = (s: AgentStats) => Object.values(s.status).reduce((a, b) => a + b, 0);

function table(headers: string[], rows: (string | number)[][]): string {
  const cells = [headers, ...rows.map((r) => r.map(String))];
  const widths = headers.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  const line = (r: string[]) => `| ${r.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`;
  return [line(headers), `|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`, ...cells.slice(1).map(line)].join("\n");
}

// ---------- report ----------

// Run ids are UTC ISO timestamps with ":" and "." replaced by "-", so they sort and compare as text.
const sinceKey = since?.replace(/[:.]/g, "-");
const runs = (await Promise.all(files.map(analyse)))
  .filter((r): r is RunStats => r !== null)
  .filter((r) => !sinceKey || r.id >= sinceKey);

if (runs.length === 0) {
  console.log("No runs match.");
  process.exit(0);
}

const out: string[] = [];
out.push(`# Run statistics\n`);
out.push(`${runs.length} run(s): ${runs.filter((r) => r.end === "all_out").length} played to the end, ${runs.filter((r) => r.end === "stopped").length} stopped early, ${runs.filter((r) => r.end === "cut off").length} cut off.\n`);

out.push(`## Per run\n`);
out.push(
  table(
    ["Run", "Seed", "Clock", "Length", "End", "Model", "Landed", "Lines", "Too late", "Outcome", "Level", "p50", "Cost", "Winner"],
    runs.flatMap((r) =>
      r.agents.map((a) => [
        r.id.slice(0, 19),
        r.seed,
        r.mode,
        secs(r.durationMs),
        r.end,
        a.name,
        a.placedByDecision,
        a.lines,
        a.fellWithoutDecision,
        a.outcome === "topped out" ? `out at ${secs(a.outAt)}` : a.outcome,
        a.level,
        ms(pct(a.latencies, 50)),
        usd(a.costUsd),
        r.winner === a.name ? "✓" : "",
      ]),
    ),
  ),
);

// Pool by source and clock mode.
const groups = new Map<string, AgentStats[]>();
for (const r of runs) for (const a of r.agents) {
  const key = `${a.name}\u0000${a.sourceId}\u0000${a.mode}`;
  groups.set(key, [...(groups.get(key) ?? []), a]);
}

out.push(`\n## Per model, all selected runs pooled\n`);
const pooled = [...groups.entries()].map(([key, list]) => {
  const [name, sourceId, mode] = key.split("\u0000");
  const lat = list.flatMap((a) => a.latencies);
  const margin = list.flatMap((a) => a.marginMs);
  const status: Record<string, number> = {};
  for (const a of list) for (const [k, v] of Object.entries(a.status)) status[k] = (status[k] ?? 0) + v;
  const total = list.reduce((n, a) => n + answered(a), 0);
  const pieces = list.reduce((n, a) => n + a.pieces, 0);
  const tooLate = list.reduce((n, a) => n + a.fellWithoutDecision, 0);
  const lines = list.reduce((n, a) => n + a.lines, 0);
  const landed = list.reduce((n, a) => n + a.placedByDecision, 0);
  const wins = runs.filter((r) => r.winner === name && r.mode === mode && r.agents.some((a) => a.sourceId === sourceId)).length;
  const cost = list.reduce((n, a) => n + a.costUsd, 0);
  const tokensIn = list.reduce((n, a) => n + a.inputTokens, 0);
  const tokensOut = list.reduce((n, a) => n + a.outputTokens, 0);
  return {
    name, sourceId, mode, runs: list.length, wins, landed, total, pieces, tooLate, lines, status, lat, margin, cost, tokensIn, tokensOut,
    confidence: mean(list.flatMap((a) => a.confidence)),
    chosenP: mean(list.flatMap((a) => a.chosenP)),
    toppedOut: list.filter((a) => a.outcome === "topped out").map((a) => a.outAt!),
    levels: list.map((a) => a.level),
  };
});

out.push(
  table(
    ["Model", "Clock", "Runs", "Wins", "Pieces landed", "Lines", "Too late", "Landed / run", "Lines / 100 landed"],
    pooled.map((g) => [
      g.name,
      g.mode,
      g.runs,
      g.wins,
      g.landed,
      g.lines,
      g.tooLate,
      num(g.landed / g.runs, 1),
      g.landed ? num((100 * g.lines) / g.landed, 1) : "–",
    ]),
  ),
);
out.push("");
out.push(
  table(
    ["Model", "Clock", "Runs", "Decisions", "p50", "p90", "p95", "Mean", "Min", "Max"],
    pooled.map((g) => [g.name, g.mode, g.runs, g.total, ms(pct(g.lat, 50)), ms(pct(g.lat, 90)), ms(pct(g.lat, 95)), ms(mean(g.lat)), ms(pct(g.lat, 0)), ms(pct(g.lat, 100))]),
  ),
);
out.push("");
out.push(
  table(
    ["Model", "Clock", "In time", "Late", "Invalid", "Error", "Timeout", "Pieces", "Too late", "Lines", "Lines/100 pieces", "Median margin left"],
    pooled.map((g) => [
      g.name,
      g.mode,
      `${g.status.ok ?? 0} (${share(g.status.ok ?? 0, g.total)})`,
      g.status.late ?? 0,
      g.status.invalid ?? 0,
      g.status.error ?? 0,
      g.status.timeout ?? 0,
      g.pieces,
      `${g.tooLate} (${share(g.tooLate, g.pieces)})`,
      g.lines,
      g.pieces ? num((100 * g.lines) / g.pieces, 1) : "–",
      ms(pct(g.margin, 50)),
    ]),
  ),
);
out.push("");
out.push(
  table(
    ["Model", "Clock", "Tokens in / decision", "Tokens out / decision", "Cost total", "Cost / decision", "Mean confidence", "Mean p(chosen)", "Topped out", "Mean time to top out", "Max level"],
    pooled.map((g) => [
      g.name,
      g.mode,
      g.total ? Math.round(g.tokensIn / g.total) : "–",
      g.total ? Math.round(g.tokensOut / g.total) : "–",
      usd(g.cost),
      g.total ? usd(g.cost / g.total) : "–",
      num(g.confidence),
      num(g.chosenP),
      `${g.toppedOut.length}/${g.runs}`,
      secs(mean(g.toppedOut)),
      Math.max(...g.levels),
    ]),
  ),
);

out.push(`\n## Notes\n`);
out.push(`- **Landed**: pieces the model put where it chose, in time. **The board with the most pieces landed wins the run** (ties: more lines, then longer survival).`);
out.push(`- **Too late**: pieces that locked before an answer arrived (or, on the frozen clock, after a timeout or a bad answer).`);
out.push(`- **Late**: answers that arrived after their piece had already locked.`);
out.push(`- **Latency** counts every answer that came back (in time, late or invalid); failed requests are excluded.`);
out.push(`- **Median margin left**: for in-time answers, how much of the piece's deadline was still unused.`);
out.push(`- Cost is $0 when no prices are set in .env.`);
out.push(`- Runs stopped early are included; filter with --min-decisions or --since.`);

console.log(out.join("\n"));

if (jsonOut) {
  await Bun.write(
    jsonOut,
    JSON.stringify(
      {
        runs: runs.map((r) => ({ ...r, agents: r.agents.map(({ latencies, marginMs, confidence, chosenP, ...a }) => ({ ...a, p50Ms: pct(latencies, 50), p95Ms: pct(latencies, 95) })) })),
        pooled: pooled.map(({ lat, margin, ...g }) => ({ ...g, p50Ms: pct(lat, 50), p90Ms: pct(lat, 90), p95Ms: pct(lat, 95), meanMs: mean(lat), medianMarginMs: pct(margin, 50) })),
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${jsonOut}`);
}
