import { useRef } from "react";
import { useArena, useArenaState, useFrame } from "./hooks";
import { compareStandings, winRule, type RankRules } from "../arena/ranking";
import type { AgentSpec } from "../arena/types";
import { fmtBest, fmtMs, fmtSeconds, percentile, type BoardState } from "./store";

// One line per board across shared game time: how long it lasted, where it
// cleared lines, and where it went out. Levels are marked along the top.
// When the run ends, rows are ranked by the run's win rule (see arena/ranking),
// which doubles as the results table.
// There is always one row per board on screen, run or not, so the figure keeps
// the same height and the boards below it never jump.

const ROW = 46;
const LABEL_W = 150;
const PAD_TOP = 26;

export function SurvivalFigure({ figIndex, agents, rules }: { figIndex: number; agents: AgentSpec[]; rules: RankRules }) {
  const state = useArenaState();
  const { backend } = useArena();
  const nowRef = useRef<SVGLineElement>(null);

  const byId = new Map(state.boards.map((b) => [b.spec.id, b]));
  const boards = agents.map((spec) => byId.get(spec.id)).filter((b): b is BoardState => b !== undefined);
  const finished = state.status === "finished" && boards.length === agents.length;
  if (finished) boards.sort((a, b) => compareStandings(standing(a), standing(b), rules));
  // Boards without run data yet (before the first event arrives) keep their row as a placeholder.
  const waiting = agents.filter((spec) => !byId.has(spec.id));
  const live = state.status === "running" || state.status === "paused";
  const span = Math.max(30_000, state.endAt ?? state.lastAt, ...boards.map((b) => b.outAt ?? 0)) * 1.04;

  const W = 900;
  const H = PAD_TOP + Math.max(1, agents.length) * ROW + 24;
  const plotW = W - LABEL_W - 240;
  const x = (t: number) => LABEL_W + (Math.min(t, span) / span) * plotW;

  useFrame(() => {
    const el = nowRef.current;
    if (!el) return;
    const t = x(backend().now());
    el.setAttribute("x1", String(t));
    el.setAttribute("x2", String(t));
  });

  const levelMarks = state.levels.filter((l, i, all) => i === 0 || all.length < 14 || l.level % 2 === 1);

  return (
    <section className="survival figure" aria-labelledby="survival-title">
      <span className="fig-tag" aria-hidden="true">
        FIG_{String(figIndex).padStart(3, "0")}
      </span>
      <h2 id="survival-title" className="section-title">
        {finished ? "Results" : "Survival"}
      </h2>
      <p className="section-note">
        Each line is one board over the same game clock. Ticks are line clears; the line ends where the board stopped. {winRule(rules)} "Best" is how often it picked the reference heuristic's top option.
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMin meet" role="img" aria-label="Survival time per board">
        {levelMarks.map((l) => (
          <g key={l.at}>
            <line x1={x(l.at)} x2={x(l.at)} y1={PAD_TOP - 8} y2={H - 20} stroke="var(--ink-faint)" strokeDasharray="2 4" />
            <text x={x(l.at) + 3} y={PAD_TOP - 12} fontFamily="var(--font-mono)" fontSize="11" fill="var(--muted)">
              L{l.level}
            </text>
          </g>
        ))}
        {boards.map((b, i) => (
          <SurvivalRow key={b.spec.id} b={b} y={PAD_TOP + i * ROW + ROW / 2} x={x} rank={finished ? i + 1 : null} endX={W} liveAt={live ? state.lastAt : state.endAt ?? state.lastAt} />
        ))}
        {waiting.map((spec, i) => (
          <WaitingRow key={spec.id} name={spec.name} y={PAD_TOP + (boards.length + i) * ROW + ROW / 2} x0={x(0)} x1={LABEL_W + plotW} />
        ))}
        <line x1={LABEL_W} x2={LABEL_W + plotW} y1={H - 18} y2={H - 18} stroke="var(--ink-soft)" />
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text key={f} x={LABEL_W + f * plotW} y={H - 2} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="11" fill="var(--muted)">
            {fmtSeconds(f * span)}
          </text>
        ))}
        {live && <line ref={nowRef} y1={PAD_TOP - 8} y2={H - 18} stroke="var(--ink)" strokeWidth="1" />}
      </svg>
    </section>
  );
}

function WaitingRow({ name, y, x0, x1 }: { name: string; y: number; x0: number; x1: number }) {
  return (
    <g>
      <text x={0} y={y - 4} fontFamily="var(--font-pixel)" fontSize="15" fill="var(--ink)">
        {name}
      </text>
      <text x={0} y={y + 13} fontFamily="var(--font-mono)" fontSize="11" fill="var(--muted)">
        waiting for a run
      </text>
      <line x1={x0} x2={x1} y1={y} y2={y} stroke="var(--ink-faint)" strokeDasharray="2 4" />
    </g>
  );
}

function SurvivalRow({
  b,
  y,
  x,
  rank,
  endX,
  liveAt,
}: {
  b: BoardState;
  y: number;
  x: (t: number) => number;
  rank: number | null;
  endX: number;
  liveAt: number;
}) {
  const end = b.outAt ?? liveAt;
  const p50 = percentile(b.stats.latencies, 50);
  const outcome =
    b.outAt === null
      ? "still playing"
      : b.reachedGoal
        ? `finished at ${fmtSeconds(b.outAt)}, ${b.stats.pieces} pieces`
        : b.survived
          ? `survived, ${b.stats.pieces} pieces`
          : `out at ${fmtSeconds(b.outAt)}, L${b.outLevel}`;
  const ex = x(end);
  return (
    <g>
      <text x={0} y={y - 4} fontFamily="var(--font-pixel)" fontSize="15" fill="var(--ink)">
        {rank !== null ? `${rank}. ` : ""}
        {b.spec.name}
      </text>
      <text x={0} y={y + 13} fontFamily="var(--font-mono)" fontSize="11" fill="var(--muted)">
        {p50 === null ? "no decisions yet" : `${fmtMs(p50)} per decision`}
      </text>
      <line x1={x(0)} x2={ex} y1={y} y2={y} stroke="var(--ink)" strokeWidth="2" />
      {b.linesAt.slice(1).map((p) => (
        <line key={p.at} x1={x(p.at)} x2={x(p.at)} y1={y - 6} y2={y + 6} stroke="var(--ink)" strokeWidth="1" />
      ))}
      {b.outAt !== null &&
        (b.survived || b.reachedGoal ? (
          <rect x={ex - 5} y={y - 5} width="10" height="10" fill="var(--ink)" />
        ) : (
          <path d={`M${ex - 6} ${y - 6} L${ex + 6} ${y + 6} M${ex + 6} ${y - 6} L${ex - 6} ${y + 6}`} stroke="var(--ink)" strokeWidth="2" />
        ))}
      <text x={endX} y={y - 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize="13" fill="var(--text)">
        {b.stats.landed} landed, {b.stats.lines} lines, {fmtBest(b.stats)} best
      </text>
      <text x={endX} y={y + 13} textAnchor="end" fontFamily="var(--font-mono)" fontSize="11" fill="var(--muted)">
        {outcome}
      </text>
    </g>
  );
}

function standing(b: BoardState) {
  return { landed: b.stats.landed, lines: b.stats.lines, pieces: b.stats.pieces, outAt: b.outAt, reachedGoal: b.reachedGoal };
}
