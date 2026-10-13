import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { compareStandings, winRule, type RankRules } from "../arena/ranking";
import type { AgentKind, RunConfig } from "../arena/types";
import { standing } from "./ScoreStrip";
import { fmtClock, fmtCost, fmtMs, percentile, type BoardState } from "./store";

// The screen after a fight, sized to one window with no scrolling so it can be
// recorded as is. Four charts and one table, revealed in beats: the race
// replayed, smart against fast, the game over time, time per decision, then
// one row of numbers per model. Each model keeps one colour and marker throughout.

const KIND = { "system-one": "System One", llm: "Language model", baseline: "Baseline" } satisfies Record<AgentKind, string>;
const SHAPES = ["circle", "square", "diamond", "triangle", "star", "cross"] as const;
type Shape = (typeof SHAPES)[number];

const RACE_MS = 5000;
const BEAT = { race: 300, scatter: 700, time: 1200, bars: 1700, table: 2300 };

interface Row {
  b: BoardState;
  /** Position on the fight screen; picks the model's colour and marker. */
  slot: number;
  key: string;
  color: string;
  shape: Shape;
  rank: number;
  name: string;
  kind: AgentKind;
  landed: number;
  pieces: number;
  lines: number;
  /** Share of graded answers that were the heuristic's top pick, 0–1; null when nothing was graded. */
  best: number | null;
  p50: number | null;
  p95: number | null;
  inTime: number | null;
  late: number;
  bad: number;
  cost: number;
  costPerLanded: number | null;
  tokens: number;
  outcome: string;
}

interface Props {
  boards: BoardState[];
  config: RunConfig;
  rules: RankRules;
  endAt: number;
  mocked: boolean;
  onBack: () => void;
  onReplay: () => void;
  onRunAgain: () => void;
}

export function ResultsScreen({ boards, config, rules, endAt, mocked, onBack, onReplay, onRunAgain }: Props) {
  const rows = toRows(boards, rules);
  const winner = rows[0];
  const sprint = rules.targetLines > 0;
  const metric = sprint ? "lines" : "landed";

  return (
    <main className="page results">
      <header className="results-head reveal" style={delay(0)}>
        <div>
          <p className="results-kicker">
            {config.mode === "realtime" ? "Real-time clock" : "Frozen clock"}, {sprint ? `race to ${rules.targetLines} lines` : "survive"}, seed {config.seed}, {fmtClock(endAt)} of game time
            {mocked ? ". Preview with mocked models." : "."}
          </p>
          <h1 className="results-title">{winner ? `${winner.name} wins` : "No result"}</h1>
          <p className="results-rule">{winRule(rules)}</p>
        </div>
        <ul className="results-legend" aria-label="Models">
          {[...rows]
            .sort((a, b) => a.slot - b.slot)
            .map((r) => (
              <li key={r.key}>
                <Marker shape={r.shape} color={r.color} />
                {r.name}
              </li>
            ))}
        </ul>
        <div className="btn-row results-actions">
          <button type="button" className="btn" onClick={onBack}>
            Back to boards
          </button>
          <button type="button" className="btn" onClick={onReplay}>
            Replay
          </button>
          <button type="button" className="btn primary" onClick={onRunAgain}>
            Run again
          </button>
        </div>
      </header>

      <Card area="race" title="The game, replayed" note={sprint ? "Lines cleared, played back." : "Pieces landed, played back."} at={BEAT.race}>
        <Race rows={rows} metric={metric} endAt={endAt} startDelay={BEAT.race + 400} />
      </Card>

      <Card area="time" title="Over the game" note={sprint ? "Lines cleared against game time." : "Pieces landed against game time. A line goes flat when its board tops out."} at={BEAT.time}>
        <OverTime rows={rows} metric={metric} endAt={endAt} />
      </Card>

      <Card area="scatter" title="Smart versus fast" note="Best moves against time per decision. Up is smarter, left is faster." at={BEAT.scatter}>
        <SmartFast rows={rows} />
      </Card>

      <Card area="speed" title="Time per decision" note="Median time to answer, with the slowest 5% (p95) after it. Lower is better." at={BEAT.bars}>
        <SpeedBars rows={rows} />
      </Card>

      <section className="results-card results-table reveal" style={{ ...delay(BEAT.table), gridArea: "table" }} aria-label="Every number">
        <SummaryTable rows={rows} sprint={sprint} startDelay={BEAT.table + 200} />
      </section>
    </main>
  );
}

function Card({ area, title, note, at, children }: { area: string; title: string; note: string; at: number; children: ReactNode }) {
  return (
    <section className="results-card reveal" style={{ ...delay(at), gridArea: area }} aria-label={title}>
      <h2 className="section-title">{title}</h2>
      <p className="section-note">{note}</p>
      <div className="chart-box">{children}</div>
    </section>
  );
}

// ---------- the race: the run's own history played back, bars reordering as they overtake ----------

function Race({ rows, metric, endAt, startDelay }: { rows: Row[]; metric: "landed" | "lines"; endAt: number; startDelay: number }) {
  const t = useProgress(startDelay, RACE_MS);
  const at = t * endAt;
  const values = rows.map((r) => valueAt(r.b, metric, at));
  const max = Math.max(1, ...rows.map((r) => r[metric]));
  const done = t >= 1;
  // While playing, order by the value so far; at the end, by the official ranking.
  const order = rows
    .map((r, i) => ({ r, v: values[i] }))
    .sort((a, b) => (done ? a.r.rank - b.r.rank : b.v - a.v || a.r.rank - b.r.rank));
  const place = new Map(order.map((o, k) => [o.r.key, k]));

  return (
    <div className="race" style={{ ["--n" as string]: rows.length }} role="img" aria-label={`Final ranking: ${rows.map((r) => r.name).join(", ")}`}>
      {rows.map((r, i) => (
        <div key={r.key} className="race-row" data-winner={done && r.rank === 1 ? "true" : undefined} style={{ transform: `translateY(${(place.get(r.key) ?? i) * 100}%)` }}>
          <span className="race-rank">{done ? r.rank : (place.get(r.key) ?? i) + 1}</span>
          <span className="race-name">{r.name}</span>
          <span className="race-track">
            <span className="race-fill" style={{ width: `${(values[i] / max) * 100}%`, background: r.color }} />
          </span>
          <span className="race-value">{values[i]}</span>
        </div>
      ))}
      <span className="race-clock">{fmtClock(at)}</span>
    </div>
  );
}

function valueAt(b: BoardState, metric: "landed" | "lines", at: number): number {
  let v = 0;
  for (const p of b.progress) {
    if (p.at > at) break;
    v = p[metric];
  }
  return v;
}

// ---------- charts ----------

const AXIS = { fontFamily: "var(--font-mono)", fontSize: 11, fill: "var(--muted)" };
const animate = !reducedMotion();

function OverTime({ rows, metric, endAt }: { rows: Row[]; metric: "landed" | "lines"; endAt: number }) {
  const N = 80;
  const data = Array.from({ length: N + 1 }, (_, k) => {
    const at = (k / N) * endAt;
    const point: Record<string, number> = { at };
    for (const r of rows) point[r.key] = valueAt(r.b, metric, at);
    return point;
  });
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid stroke="var(--ink-faint)" strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="at" type="number" domain={[0, endAt]} tickFormatter={fmtClock} tick={AXIS} stroke="var(--ink-soft)" tickCount={5} />
        <YAxis tick={AXIS} stroke="var(--ink-soft)" width={44} />
        {[...rows].reverse().map((r) => (
          <Line
            key={r.key}
            dataKey={r.key}
            type="stepAfter"
            stroke={r.color}
            strokeWidth={r.rank === 1 ? 3 : 1.75}
            dot={false}
            isAnimationActive={animate}
            animationBegin={BEAT.time + 300}
            animationDuration={2200}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function SmartFast({ rows }: { rows: Row[] }) {
  const pts = rows.filter((r) => r.p50 !== null && r.best !== null);
  const lo = Math.min(100, ...pts.map((r) => r.p50!)) / 1.6;
  const hi = Math.max(2000, ...pts.map((r) => r.p50!)) * 1.6;
  // The y axis starts just under the weakest model, in steps of 10%, so close scores stay apart.
  const yMin = Math.max(0, Math.floor(Math.min(100, ...pts.map((r) => r.best! * 100)) / 10 - 0.5) * 10);
  const ticks = [10, 30, 100, 300, 1000, 3000, 10_000, 30_000].filter((v) => v >= lo && v <= hi);
  const midX = Math.sqrt(lo * hi);
  const midY = (100 + yMin) / 2;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
        <CartesianGrid stroke="var(--ink-faint)" strokeDasharray="2 4" />
        <ReferenceArea
          x1={lo}
          x2={midX}
          y1={midY}
          y2={100}
          fill="var(--ink-faint)"
          fillOpacity={0.35}
          stroke="none"
          label={{ value: "fast and smart", position: "insideTopLeft", style: { ...AXIS, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13 } }}
        />
        <XAxis dataKey="p50" type="number" scale="log" domain={[lo, hi]} ticks={ticks} tickFormatter={fmtMs} tick={AXIS} stroke="var(--ink-soft)" allowDataOverflow />
        <YAxis dataKey="best" type="number" domain={[yMin, 102]} ticks={Array.from({ length: Math.round((100 - yMin) / 5) + 1 }, (_, k) => yMin + k * 5).filter((_, k, all) => all.length <= 7 || k % 2 === 0)} tickFormatter={(v: number) => `${v}%`} tick={AXIS} stroke="var(--ink-soft)" width={48} allowDataOverflow />
        <ZAxis range={[220, 220]} />
        {pts.map((r) => (
          <Scatter
            key={r.key}
            data={[{ p50: r.p50, best: r.best! * 100 }]}
            fill={r.color}
            shape={r.shape}
            isAnimationActive={animate}
            animationBegin={BEAT.scatter + 300 + r.slot * 150}
            animationDuration={600}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** One bar per model, in rank order, in the model's colour; the label gives p50 and p95. */
function SpeedBars({ rows }: { rows: Row[] }) {
  const data = rows.map((r) => ({
    name: r.name,
    p50: r.p50 ?? 0,
    color: r.color,
    label: r.p50 === null ? "no answers" : `${fmtMs(r.p50)}   p95 ${r.p95 === null ? "–" : fmtMs(r.p95)}`,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 150, bottom: 0, left: 0 }} barCategoryGap="28%">
        <XAxis type="number" hide domain={[0, "auto"]} />
        <YAxis type="category" dataKey="name" width={150} tick={<NameTick />} tickLine={false} axisLine={{ stroke: "var(--ink-soft)" }} interval={0} />
        <Bar dataKey="p50" isAnimationActive={animate} animationBegin={BEAT.bars + 300} animationDuration={900}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
          <LabelList dataKey="label" position="right" style={{ ...AXIS, fill: "var(--text)", fontSize: 12 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Model names on one line, never wrapped, in the display face. */
function NameTick(props: { x?: number; y?: number; payload?: { value: string } }) {
  return (
    <text x={(props.x ?? 0) - 8} y={(props.y ?? 0) + 4} textAnchor="end" className="name-tick">
      {props.payload?.value}
    </text>
  );
}

// ---------- every number, one row per model ----------

function SummaryTable({ rows, sprint, startDelay }: { rows: Row[]; sprint: boolean; startDelay: number }) {
  const cols: { label: string; value: (r: Row) => number | null; fmt: (v: number) => string; better?: "high" | "low" }[] = [
    { label: "Landed", value: (r) => r.landed, fmt: int, better: "high" },
    { label: "Dealt", value: (r) => r.pieces, fmt: int },
    { label: "Lines", value: (r) => r.lines, fmt: int, better: "high" },
    { label: "In time", value: (r) => (r.inTime === null ? null : r.inTime * 100), fmt: pct, better: "high" },
    { label: "Best moves", value: (r) => (r.best === null ? null : r.best * 100), fmt: pct, better: "high" },
    { label: "p50", value: (r) => r.p50, fmt: fmtMs, better: "low" },
    { label: "p95", value: (r) => r.p95, fmt: fmtMs, better: "low" },
    { label: "Too late", value: (r) => r.late, fmt: int, better: "low" },
    { label: "Bad", value: (r) => r.bad, fmt: int, better: "low" },
    { label: "Tokens", value: (r) => r.tokens, fmt: (v) => Math.round(v).toLocaleString("en-US") },
    { label: "Cost", value: (r) => r.cost, fmt: fmtCost, better: "low" },
    { label: "Per landed", value: (r) => r.costPerLanded, fmt: fmtCost, better: "low" },
  ];
  // Mark a column's best only when it stands out: not when half the field ties for it.
  const tops = cols.map((c) => {
    const known = rows.map(c.value).filter((v): v is number => v !== null);
    if (!c.better || known.length < 2) return null;
    const top = c.better === "high" ? Math.max(...known) : Math.min(...known);
    return known.filter((v) => v === top).length * 2 <= known.length ? top : null;
  });
  return (
    <table className="metric-table">
      <thead>
        <tr>
          <th scope="col" className="mt-left">
            Model
          </th>
          {cols.map((c) => (
            <th key={c.label} scope="col">
              {c.label}
            </th>
          ))}
          <th scope="col" className="mt-left">
            {sprint ? "Finish" : "Outcome"}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={r.key}>
            <th scope="row" className="mt-left">
              <span className="mt-rank">{r.rank}</span>
              <Marker shape={r.shape} color={r.color} />
              <span className="mt-name">{r.name}</span>
              <span className="mt-kind">{KIND[r.kind]}</span>
            </th>
            {cols.map((c, ci) => {
              const v = c.value(r);
              return (
                <td key={c.label} data-top={tops[ci] !== null && v === tops[ci] ? "true" : undefined}>
                  <CountUp value={v} fmt={c.fmt} startDelay={startDelay + ri * 60} />
                </td>
              );
            })}
            <td className="mt-left mt-outcome">{r.outcome}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- helpers ----------

/** A small SVG marker in the model's colour and shape, for the legend and the table. */
function Marker({ shape, color }: { shape: Shape; color: string }) {
  const paths: Record<Shape, string> = {
    circle: "M6 1a5 5 0 1 0 0 10A5 5 0 0 0 6 1z",
    square: "M1.5 1.5h9v9h-9z",
    diamond: "M6 0.5l5.5 5.5L6 11.5 0.5 6z",
    triangle: "M6 1l5.5 10h-11z",
    star: "M6 0.5l1.6 3.6 3.9.4-2.9 2.6.8 3.9L6 9 2.6 11l.8-3.9L.5 4.5l3.9-.4z",
    cross: "M4.5 0.5h3v4h4v3h-4v4h-3v-4h-4v-3h4z",
  };
  return (
    <svg className="marker" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d={paths[shape]} fill={color} />
    </svg>
  );
}

const int = (v: number) => String(Math.round(v));
const pct = (v: number) => `${Math.round(v)}%`;

function toRows(boards: BoardState[], rules: RankRules): Row[] {
  return boards
    .map((b, slot) => ({ b, slot }))
    .sort((x, y) => compareStandings(standing(x.b), standing(y.b), rules))
    .map(({ b, slot }, i) => {
      const st = b.stats;
      return {
        b,
        slot,
        key: `m${slot}`,
        color: `var(--series-${(slot % 6) + 1})`,
        shape: SHAPES[slot % SHAPES.length],
        rank: i + 1,
        name: b.spec.name,
        kind: b.spec.kind,
        landed: st.landed,
        pieces: st.pieces,
        lines: st.lines,
        best: st.graded ? st.best / st.graded : null,
        p50: percentile(st.latencies, 50),
        p95: percentile(st.latencies, 95),
        inTime: st.pieces ? st.landed / st.pieces : null,
        late: st.dropped,
        bad: st.invalid + st.errors + st.blocked,
        cost: st.costUsd,
        costPerLanded: st.landed ? st.costUsd / st.landed : null,
        tokens: st.inputTokens + st.outputTokens,
        outcome: b.reachedGoal ? `${rules.targetLines} lines at ${fmtClock(b.outAt ?? 0)}` : b.survived ? "survived" : b.outAt !== null ? `out at ${fmtClock(b.outAt)}` : "still playing",
      };
    });
}

function delay(ms: number) {
  return { ["--delay" as string]: `${ms}ms` } as CSSProperties;
}

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 0 → 1 over `duration` after `startDelay`, eased; jumps to 1 when motion is reduced. */
function useProgress(startDelay: number, duration: number): number {
  const [t, setT] = useState(() => (reducedMotion() ? 1 : 0));
  useEffect(() => {
    if (reducedMotion()) return;
    let frame = 0;
    const start = performance.now() + startDelay;
    const step = (now: number) => {
      const raw = Math.min(1, Math.max(0, (now - start) / duration));
      setT(1 - Math.pow(1 - raw, 3));
      if (raw < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [startDelay, duration]);
  return t;
}

function CountUp({ value, fmt, startDelay }: { value: number | null; fmt: (v: number) => string; startDelay: number }) {
  const t = useProgress(startDelay, 900);
  return <span>{value === null ? "–" : fmt(value * t)}</span>;
}
