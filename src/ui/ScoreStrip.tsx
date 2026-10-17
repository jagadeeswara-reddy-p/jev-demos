import { compareStandings, type RankRules } from "../arena/ranking";
import type { AgentSpec } from "../arena/types";
import { useArenaState } from "./hooks";
import { type BoardState, fmtBest, fmtMs, percentile } from "./store";

// The live leaderboard above the boards during a fight. One slot per model,
// ordered by the run's win rule; when the order changes the slots slide to
// their new places, so overtakes are visible without reading numbers.

export function ScoreStrip({ agents, rules }: { agents: AgentSpec[]; rules: RankRules }) {
  const state = useArenaState();
  const byId = new Map(state.boards.map((b) => [b.spec.id, b]));
  const ranked = agents
    .map((spec, i) => ({ spec, b: byId.get(spec.id), i }))
    .sort((x, y) => (x.b && y.b ? compareStandings(standing(x.b), standing(y.b), rules) || x.i - y.i : x.i - y.i));
  const place = new Map(ranked.map((r, rank) => [r.spec.id, rank]));
  const n = Math.max(1, agents.length);

  return (
    <ol className="score-strip" aria-label="Live standings" style={{ ["--slots" as string]: n }}>
      {agents.map((spec) => {
        const rank = place.get(spec.id) ?? 0;
        const b = byId.get(spec.id);
        const p50 = b ? percentile(b.stats.latencies, 50) : null;
        const metric = rules.targetLines > 0 ? `${b?.stats.lines ?? 0}/${rules.targetLines} lines` : `${b?.stats.landed ?? 0} landed`;
        return (
          <li
            key={spec.id}
            className="score-slot"
            data-leader={rank === 0 && (b?.stats.pieces ?? 0) > 0 ? "true" : undefined}
            data-out={b?.outAt !== null && b?.outAt !== undefined && !b.reachedGoal && !b.survived ? "true" : undefined}
            style={{ transform: `translateX(${rank * 100}%)` }}
          >
            <span className="score-rank">{rank + 1}</span>
            <span className="score-body">
              <span className="score-name">{spec.name}</span>
              <span className="score-metric">{metric}</span>
              <span className="score-sub">
                {b
                  ? `${rules.targetLines > 0 ? `${b.stats.landed} landed` : `${b.stats.lines} lines`}, ${fmtBest(b.stats)} best, ${p50 === null ? "–" : fmtMs(p50)}`
                  : "waiting"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function standing(b: BoardState) {
  return { landed: b.stats.landed, lines: b.stats.lines, pieces: b.stats.pieces, outAt: b.outAt, reachedGoal: b.reachedGoal };
}
