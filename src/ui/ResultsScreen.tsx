import { useEffect, useState, type CSSProperties } from "react";
import { compareStandings, winRule, type RankRules } from "../arena/ranking";
import type { AgentKind, RunConfig } from "../arena/types";
import { standing } from "./ScoreStrip";
import { fmtClock, fmtCost, fmtMs, percentile, type BoardState } from "./store";

// The screen after a fight. It reveals in order, one beat at a time, so a
// recording can sit on it: the winner, the race replayed, smart against fast,
// then each measure side by side, then every number in one table.

const KIND = { "system-one": "System One model", llm: "Language model", baseline: "Baseline" } satisfies Record<AgentKind, string>;

const RACE_MS = 5000;
const BEAT = {
  race: 300,
  scatter: 1200,
  minis: RACE_MS + 600,
  table: RACE_MS + 2200,
};

interface Row {
  b: BoardState;
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

      <div className="results-grid">
        <section className="results-card reveal" style={delay(BEAT.race)} aria-labelledby="race-title">
          <h2 id="race-title" className="section-title">
            The game, replayed
          </h2>
          <p className="section-note">{sprint ? "Lines cleared over the game." : "Pieces landed over the game: placed where the model chose, in time."}</p>
          <Race rows={rows} metric={sprint ? "lines" : "landed"} endAt={endAt} startDelay={BEAT.race + 400} />
        </section>

        <section className="results-card reveal" style={delay(BEAT.scatter)} aria-labelledby="scatter-title">
          <h2 id="scatter-title" className="section-title">
            Smart versus fast
          </h2>
          <p className="section-note">How good each model's choices were against how long it took to make them. Up is better moves, left is faster.</p>
          <Scatter rows={rows} startDelay={BEAT.scatter + 300} />
        </section>
      </div>

      <div className="results-minis">
        <MiniBars title="Pieces landed" rows={rows} value={(r) => r.landed} fmt={(v) => String(Math.round(v))} better="high" startDelay={BEAT.minis} />
        <MiniBars title="Best moves" rows={rows} value={(r) => (r.best === null ? null : r.best * 100)} fmt={(v) => `${Math.round(v)}%`} better="high" startDelay={BEAT.minis + 250} />
        <MiniBars title="Decision time, p50" rows={rows} value={(r) => r.p50} fmt={fmtMs} better="low" startDelay={BEAT.minis + 500} />
        <MiniBars title="Too late or bad" rows={rows} value={(r) => r.late + r.bad} fmt={(v) => String(Math.round(v))} better="low" startDelay={BEAT.minis + 750} />
        <MiniBars title="Cost" rows={rows} value={(r) => r.cost} fmt={fmtCost} better="low" startDelay={BEAT.minis + 1000} />
      </div>

      <section className="results-card reveal" style={delay(BEAT.table)} aria-labelledby="table-title">
        <h2 id="table-title" className="section-title">
          Every number
        </h2>
        <MetricTable rows={rows} startDelay={BEAT.table + 200} />
      </section>
    </main>
  );
}

// ---------- the race: the run's own history played back, bars reordering as they overtake ----------

function Race({ rows, metric, endAt, startDelay }: { rows: Row[]; metric: "landed" | "lines"; endAt: number; startDelay: number }) {
  const t = useProgress(startDelay, RACE_MS);
  const at = t * endAt;
  const values = rows.map((r) => valueAt(r.b, metric, at));
  const max = Math.max(1, ...rows.map((r) => (metric === "landed" ? r.landed : r.lines)));
  const done = t >= 1;
  // While playing, order by the value so far; at the end, by the official ranking.
  const order = rows
    .map((r, i) => ({ r, i, v: values[i] }))
    .sort((a, b) => (done ? a.r.rank - b.r.rank : b.v - a.v || a.r.rank - b.r.rank));
  const slot = new Map(order.map((o, k) => [o.r.name, k]));

  return (
    <div className="race" style={{ height: rows.length * 44 }} role="img" aria-label={`Final ranking: ${rows.map((r) => r.name).join(", ")}`}>
      {rows.map((r, i) => (
        <div key={r.name} className="race-row" data-winner={done && r.rank === 1 ? "true" : undefined} style={{ transform: `translateY(${(slot.get(r.name) ?? i) * 44}px)` }}>
          <span className="race-rank">{done ? r.rank : (slot.get(r.name) ?? i) + 1}</span>
          <span className="race-name">{r.name}</span>
          <span className="race-track">
            <span className="race-fill" style={{ width: `${(values[i] / max) * 100}%` }} />
          </span>
          <span className="race-value">
            {values[i]} {metric}
          </span>
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

// ---------- smart versus fast ----------

const SC = { W: 560, H: 300, L: 44, R: 16, T: 14, B: 36 };

function Scatter({ rows, startDelay }: { rows: Row[]; startDelay: number }) {
  const plotted = rows.filter((r) => r.p50 !== null && r.best !== null);
  const lo = Math.min(100, ...plotted.map((r) => r.p50!)) / 1.6;
  const hi = Math.max(2000, ...plotted.map((r) => r.p50!)) * 1.6;
  const x = (ms: number) => SC.L + ((Math.log(ms) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (SC.W - SC.L - SC.R);
  const y = (share: number) => SC.T + (1 - share) * (SC.H - SC.T - SC.B);
  const ticks = [10, 30, 100, 300, 1000, 3000, 10_000, 30_000].filter((v) => v >= lo && v <= hi);

  return (
    <svg className="scatter" viewBox={`0 0 ${SC.W} ${SC.H}`} role="img" aria-label="Best-move share against decision time">
      <rect x={SC.L} y={SC.T} width={(SC.W - SC.L - SC.R) / 2} height={(SC.H - SC.T - SC.B) / 2} fill="var(--ink-faint)" opacity="0.35" />
      <text x={SC.L + 8} y={SC.T + 18} className="scatter-zone">
        fast and smart
      </text>
      {[0, 0.25, 0.5, 0.75, 1].map((s) => (
        <g key={s}>
          <line x1={SC.L} x2={SC.W - SC.R} y1={y(s)} y2={y(s)} stroke="var(--ink-faint)" strokeDasharray="2 4" />
          <text x={SC.L - 6} y={y(s) + 4} textAnchor="end" className="scatter-tick">
            {s * 100}%
          </text>
        </g>
      ))}
      {ticks.map((v) => (
        <text key={v} x={x(v)} y={SC.H - SC.B + 16} textAnchor="middle" className="scatter-tick">
          {fmtMs(v)}
        </text>
      ))}
      <line x1={SC.L} x2={SC.W - SC.R} y1={SC.H - SC.B} y2={SC.H - SC.B} stroke="var(--ink-soft)" />
      <text x={SC.W - SC.R} y={SC.H - 4} textAnchor="end" className="scatter-tick">
        decision time, p50 (log scale) →
      </text>
      {plotted.map((r, i) => {
        const cx = x(r.p50!);
        const cy = y(r.best!);
        const right = cx < SC.W * 0.7;
        return (
          <g key={r.name} className="scatter-dot" style={delay(startDelay + i * 180)}>
            <circle cx={cx} cy={cy} r={r.rank === 1 ? 7 : 5.5} fill={r.rank === 1 ? "var(--ink)" : "var(--sheet)"} stroke="var(--ink)" strokeWidth="1.5" />
            <text x={cx + (right ? 11 : -11)} y={cy + 4} textAnchor={right ? "start" : "end"} className="scatter-label">
              {r.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------- one measure per panel, same model order everywhere ----------

function MiniBars({
  title,
  rows,
  value,
  fmt,
  better,
  startDelay,
}: {
  title: string;
  rows: Row[];
  value: (r: Row) => number | null;
  fmt: (v: number) => string;
  better: "high" | "low";
  startDelay: number;
}) {
  const vals = rows.map(value);
  const known = vals.filter((v): v is number => v !== null);
  const max = Math.max(...known, 1e-9);
  const top = known.length ? (better === "high" ? Math.max(...known) : Math.min(...known)) : null;
  return (
    <section className="results-card mini reveal" style={delay(startDelay)}>
      <h3 className="mini-title">
        {title}
        <span className="mini-better">{better === "high" ? "higher is better" : "lower is better"}</span>
      </h3>
      <ul className="mini-list">
        {rows.map((r, i) => {
          const v = vals[i];
          return (
            <li key={r.name} data-top={v !== null && v === top ? "true" : undefined}>
              <span className="mini-name">{r.name}</span>
              <span className="mini-track">
                <span className="mini-fill grow" style={{ width: v === null ? 0 : `${Math.max(1.5, (v / max) * 100)}%`, ...delay(startDelay + 150 + i * 60) }} />
              </span>
              <CountUp className="mini-value" value={v} fmt={fmt} startDelay={startDelay + 150 + i * 60} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- every number ----------

function MetricTable({ rows, startDelay }: { rows: Row[]; startDelay: number }) {
  const lines: { label: string; value: (r: Row) => number | null; fmt: (v: number) => string; better?: "high" | "low" }[] = [
    { label: "Pieces landed", value: (r) => r.landed, fmt: (v) => String(Math.round(v)), better: "high" },
    { label: "Pieces dealt", value: (r) => r.pieces, fmt: (v) => String(Math.round(v)) },
    { label: "Lines cleared", value: (r) => r.lines, fmt: (v) => String(Math.round(v)), better: "high" },
    { label: "Placed in time", value: (r) => (r.inTime === null ? null : r.inTime * 100), fmt: (v) => `${Math.round(v)}%`, better: "high" },
    { label: "Best moves", value: (r) => (r.best === null ? null : r.best * 100), fmt: (v) => `${Math.round(v)}%`, better: "high" },
    { label: "Decision time p50", value: (r) => r.p50, fmt: fmtMs, better: "low" },
    { label: "Decision time p95", value: (r) => r.p95, fmt: fmtMs, better: "low" },
    { label: "Too late", value: (r) => r.late, fmt: (v) => String(Math.round(v)), better: "low" },
    { label: "Bad answers", value: (r) => r.bad, fmt: (v) => String(Math.round(v)), better: "low" },
    { label: "Tokens", value: (r) => r.tokens, fmt: (v) => Math.round(v).toLocaleString("en-US") },
    { label: "Cost", value: (r) => r.cost, fmt: fmtCost, better: "low" },
    { label: "Cost per landed piece", value: (r) => r.costPerLanded, fmt: fmtCost, better: "low" },
  ];
  return (
    <div className="table-scroll">
      <table className="metric-table">
        <thead>
          <tr>
            <th scope="col" />
            {rows.map((r) => (
              <th key={r.name} scope="col">
                <span className="mt-rank">{r.rank}</span>
                {r.name}
                <span className="mt-kind">{KIND[r.kind]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, li) => {
            const vals = rows.map(line.value);
            const known = vals.filter((v): v is number => v !== null);
            const top = line.better && known.length > 1 ? (line.better === "high" ? Math.max(...known) : Math.min(...known)) : null;
            return (
              <tr key={line.label}>
                <th scope="row">{line.label}</th>
                {rows.map((r, i) => (
                  <td key={r.name} data-top={top !== null && vals[i] === top ? "true" : undefined}>
                    <CountUp value={vals[i]} fmt={line.fmt} startDelay={startDelay + li * 70} />
                  </td>
                ))}
              </tr>
            );
          })}
          <tr>
            <th scope="row">Outcome</th>
            {rows.map((r) => (
              <td key={r.name} className="mt-outcome">
                {r.outcome}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------- helpers ----------

function toRows(boards: BoardState[], rules: RankRules): Row[] {
  return [...boards]
    .sort((a, b) => compareStandings(standing(a), standing(b), rules))
    .map((b, i) => {
      const st = b.stats;
      return {
        b,
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
        outcome: b.reachedGoal ? `reached ${rules.targetLines} lines at ${fmtClock(b.outAt ?? 0)}` : b.survived ? "survived" : b.outAt !== null ? `topped out at ${fmtClock(b.outAt)}` : "still playing",
      };
    });
}

function delay(ms: number) {
  return { ["--delay" as string]: `${ms}ms` } as CSSProperties;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

function CountUp({ value, fmt, startDelay, className }: { value: number | null; fmt: (v: number) => string; startDelay: number; className?: string }) {
  const t = useProgress(startDelay, 900);
  return <span className={className}>{value === null ? "–" : t > 0 ? fmt(value * t) : fmt(0)}</span>;
}
