import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { VISIBLE_HEIGHT } from "../engine/board";
import { WIDTH_CELLS, drawBoard } from "./drawBoard";
import { useArena, useFrame } from "./hooks";
import { fmtBest, fmtCost, fmtMs, percentile, type BoardState, type ShownStatus } from "./store";
import type { AgentSpec, SourceInfo } from "../arena/types";

const KIND_LABEL = { "system-one": "System One model", llm: "Language model", baseline: "Baseline" } as const;

interface Props {
  index: number;
  spec: AgentSpec;
  sources: SourceInfo[];
  board: BoardState | undefined;
}

export function BoardFigure({ index, spec, sources, board }: Props) {
  const source = sources.find((s) => s.id === spec.sourceId);
  const kindText = source ? (source.available ? source.description : `${source.description}. ${source.reason}.`) : KIND_LABEL[spec.kind];
  const tag = `FIG_${String(index + 1).padStart(3, "0")}`;
  return (
    <figure className="figure" aria-labelledby={`${spec.id}-name`} style={{ margin: 0 }}>
      <span className="fig-tag" aria-hidden="true">
        {tag}
      </span>
      <div className="figure-head">
        <h2 id={`${spec.id}-name`} title={kindText}>
          {spec.name}
        </h2>
      </div>
      <DeadlineBar board={board} />
      <BoardCanvas agentId={spec.id} />
      <Stats board={board} />
    </figure>
  );
}

// Every board is drawn at the same cell size, the largest that fits all of them,
// so the figures come out the same width and height whatever their text.
const fits = new Map<string, number>();
const fitListeners = new Set<() => void>();
function reportFit(agentId: string, cell: number | null) {
  if (cell === null) fits.delete(agentId);
  else if (fits.get(agentId) !== cell) fits.set(agentId, cell);
  else return;
  for (const l of fitListeners) l();
}
function subscribeFits(l: () => void) {
  fitListeners.add(l);
  return () => fitListeners.delete(l);
}
function sharedCell(): number | null {
  return fits.size ? Math.min(...fits.values()) : null;
}

function BoardCanvas({ agentId }: { agentId: string }) {
  const { store } = useArena();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ownFit, setOwnFit] = useState(24);
  const shared = useSyncExternalStore(subscribeFits, sharedCell);
  const cell = Math.min(ownFit, shared ?? ownFit);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Fit the space given. In the full-frame layout the wrapper's height is set
    // by the page, so the board fills it; otherwise cap it by the window height.
    // On the fight screen the stats sit beside the board, so the board column
    // shrinks to the canvas and the board may use up to 62% of the card's width.
    const card = el.closest<HTMLElement>(".stage .figure");
    const fit = () => {
      const fullFrame = window.matchMedia("(min-width: 1101px)").matches;
      const byWidth = Math.floor((card ? card.clientWidth * 0.62 : el.clientWidth) / WIDTH_CELLS);
      const byHeight = fullFrame
        ? Math.floor((el.clientHeight - 2) / VISIBLE_HEIGHT)
        : Math.floor((window.innerHeight - 260) / VISIBLE_HEIGHT);
      const next = Math.max(8, Math.min(byWidth, byHeight, fullFrame ? 48 : 32));
      setOwnFit(next);
      reportFit(agentId, next);
    };
    // Resizing the canvas can resize the wrapper; refitting on the next frame keeps
    // that out of the observer's own callback.
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    if (card) ro.observe(card);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      reportFit(agentId, null);
    };
  }, [agentId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(WIDTH_CELLS * cell * dpr);
    canvas.height = Math.round((VISIBLE_HEIGHT * cell + 1) * dpr);
    canvas.style.width = `${WIDTH_CELLS * cell}px`;
    canvas.style.height = `${VISIBLE_HEIGHT * cell + 1}px`;
    canvas.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [cell]);

  useFrame(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const s = store.state;
    drawBoard(ctx, cell, s.boards.find((b) => b.spec.id === agentId), s.endAt);
  });

  return (
    <div ref={wrapRef} className="board-wrap">
      <canvas ref={canvasRef} className="board-canvas" role="img" aria-label="Tetris board" />
    </div>
  );
}

const STATUS_TEXT: Record<ShownStatus, (ms: number) => string> = {
  ok: (ms) => `decided in ${fmtMs(ms)}`,
  late: (ms) => `answered after ${fmtMs(ms)}, too late`,
  dropped: (ms) => `no answer in ${fmtMs(ms)}, piece dropped`,
  blocked: (ms) => `decided in ${fmtMs(ms)}, spot no longer reachable`,
  invalid: () => "answer wasn't one of the options",
  error: () => "request failed",
  timeout: (ms) => `no answer within ${fmtMs(ms)}`,
};

/** Live view of the current decision: time spent thinking against time left before the piece locks. */
function DeadlineBar({ board }: { board: BoardState | undefined }) {
  const { store, backend } = useArena();
  const fillRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<HTMLSpanElement>(null);
  const budgetRef = useRef<HTMLSpanElement>(null);
  const agentId = board?.spec.id;

  useFrame(() => {
    const fill = fillRef.current;
    const stateEl = stateRef.current;
    const budgetEl = budgetRef.current;
    if (!fill || !stateEl || !budgetEl) return;
    const b = store.state.boards.find((x) => x.spec.id === agentId);
    let ratio = 0;
    let over = false;
    let text = store.state.status === "idle" ? "waiting for a run" : "";
    let budget = "";
    let tone = "normal";
    if (b?.thinking) {
      const elapsed = Math.max(0, backend().now() - b.thinking.requestedAt);
      ratio = b.thinking.deadlineMs > 0 ? elapsed / b.thinking.deadlineMs : 1;
      over = ratio > 1;
      text = `deciding ${fmtMs(elapsed)}`;
      budget = `${fmtMs(b.thinking.deadlineMs)} until it locks`;
    } else if (b?.last) {
      ratio = b.last.deadlineMs > 0 ? b.last.latencyMs / b.last.deadlineMs : 1;
      over = b.last.status !== "ok";
      text = STATUS_TEXT[b.last.status](b.last.latencyMs);
      budget = b.last.deadlineMs ? `had ${fmtMs(b.last.deadlineMs)}` : "";
      tone = b.last.status === "ok" ? "normal" : "warn";
    }
    if (b?.outAt !== null && b?.outAt !== undefined) {
      text = b.reachedGoal ? `cleared ${b.stats.lines} lines` : b.survived ? "finished all pieces" : "topped out";
      budget = "";
      ratio = 0;
      tone = "normal";
    }
    fill.style.width = `${Math.min(1, ratio) * 100}%`;
    fill.dataset.over = String(over);
    if (stateEl.textContent !== text) stateEl.textContent = text;
    if (budgetEl.textContent !== budget) budgetEl.textContent = budget;
    stateEl.dataset.tone = tone;
  });

  return (
    <div className="deadline">
      <div className="deadline-text">
        <span ref={stateRef} className="state" />
        <span ref={budgetRef} />
      </div>
      <div className="deadline-track" aria-hidden="true">
        <div ref={fillRef} className="deadline-fill" />
      </div>
    </div>
  );
}

function Stats({ board }: { board: BoardState | undefined }) {
  const st = board?.stats;
  const p50 = st ? percentile(st.latencies, 50) : null;
  const p95 = st ? percentile(st.latencies, 95) : null;
  const items: [string, string, boolean?][] = [
    ["Landed", `${st?.landed ?? 0} of ${st?.pieces ?? 0}`, true],
    ["Lines", String(st?.lines ?? 0), true],
    ["Best moves", st ? fmtBest(st) : "–"],
    ["Decision p50", p50 === null ? "–" : fmtMs(p50)],
    ["Decision p95", p95 === null ? "–" : fmtMs(p95)],
    ["Too late", String(st?.dropped ?? 0), (st?.dropped ?? 0) > 0],
    ["Bad answers", String((st?.invalid ?? 0) + (st?.errors ?? 0) + (st?.blocked ?? 0))],
    ["Cost", st ? fmtCost(st.costUsd) : "$0"],
  ];
  return (
    <dl className="stats">
      {items.map(([k, v, hot]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd data-hot={hot ? "true" : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
