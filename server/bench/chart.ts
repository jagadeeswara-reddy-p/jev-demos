import type { BenchSummary, ModelSummary } from "./results";

// Renders the bench results as one self-contained SVG (light or dark), in two parts:
// 1. a scatter of good-move rate against typical answer time (best corner: top left);
// 2. bars of pieces placed in time per live game.
// Baselines (the heuristic) are yardsticks, not entrants, so they are left out.

export type ChartTheme = "light" | "dark";

interface Palette {
  bg: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  decision: string;
  language: string;
}

const PALETTES: Record<ChartTheme, Palette> = {
  light: {
    bg: "#fcfcfb",
    ink: "#0b0b0b",
    ink2: "#52514e",
    muted: "#898781",
    grid: "#e1e0d9",
    axis: "#c3c2b7",
    decision: "#2a78d6",
    language: "#eb6834",
  },
  dark: {
    bg: "#1a1a19",
    ink: "#f0efec",
    ink2: "#c3c2b7",
    muted: "#898781",
    grid: "#2c2c2a",
    axis: "#383835",
    decision: "#3987e5",
    language: "#d95926",
  },
};

const W = 880;
/** Scatter plot area. Labels sit to the right of their points, so the right edge keeps room for them. */
const PX0 = 72;
const PX1 = W - 190;
const P1_TOP = 132;
const P1_H = 260;
const P1_BOT = P1_TOP + P1_H;
const POINT_R = 7;
/** Bar part. */
const LABEL_W = 150;
const BAR_X0 = LABEL_W + 16;
const ROW_H = 30;
const BAR_H = 16;
/** Smallest room kept to the right of the longest bar for its value label. */
const MIN_VALUE_ROOM = 70;
/** Approximate advance of one character of the 12 px labels. */
const CHAR_W = 6.6;
const LABEL_MAX = 20;
/** Marks a mock row when chart drew it (--allow-mock). */
const MOCK_TAG = " (mock)";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Liberation Sans', sans-serif";
/** Widest likely glyph, as a share of the font size: text is laid out so a wide fallback font still fits. */
const WIDE = 0.6;
const FOOTER_LINE = 16;
const ARIA = "Benchmark results: good-move rate against answer time, and pieces placed in time per live game";
const TITLE = "Who chooses well, and in time?";
/** Candidate ticks of the answer-time axis, in ms. */
const TIME_TICKS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
/** Display names of environment ids. */
const ENVIRONMENTS: Record<string, string> = { tetris: "Deadline Tetris" };

type Kind = "decision" | "language";

const LEGEND: [Kind, string][] = [
  ["decision", "Decision model"],
  ["language", "Language model"],
];

/** One self-contained SVG: title, legend, scatter, bars, footer. Pure: same input, same string. */
export function renderChart(summary: BenchSummary, theme: ChartTheme): string {
  const c = PALETTES[theme];
  const rows = summary.models.filter((m) => m.kind !== "baseline");
  const notes = wrap(footer(summary, rows), Math.floor((W - 48) / (11 * WIDE)));
  const p2Top = P1_BOT + 120;
  const H = p2Top + rows.length * ROW_H + 36 + (notes.length - 1) * FOOTER_LINE;
  const present = new Set(rows.map(kindOf));

  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" rx="8" fill="${c.bg}"/>`);
  parts.push(text(24, 36, 18, 600, c.ink, TITLE));

  let lx = 24;
  for (const [kind, name] of LEGEND) {
    if (!present.has(kind)) continue;
    parts.push(marker(kind, lx + 6, 56, 5, c[kind]));
    parts.push(text(lx + 18, 60, 12, 400, c.ink2, `${name} (${kind === "decision" ? "circle" : "square"})`));
    lx += 18 + (name.length + 9) * CHAR_W + 22;
  }

  parts.push(...scatter(rows, c));
  parts.push(...bars(rows, p2Top, c));

  notes.forEach((line, i) => {
    parts.push(text(24, H - 14 - (notes.length - 1 - i) * FOOTER_LINE, 11, 400, c.muted, line));
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" role="img" aria-label="${esc(ARIA)}">\n${parts.join("\n")}\n</svg>\n`;
}

/** Part 1: good-move rate (0-100%, up is better) against median answer time (log scale, left is faster). */
function scatter(rows: ModelSummary[], c: Palette): string[] {
  const parts: string[] = [];
  parts.push(text(24, P1_TOP - 44, 14, 600, c.ink, "1 · Chooses well vs. answers fast"));
  parts.push(text(24, P1_TOP - 28, 11, 400, c.muted, "Each mark is a model. The best place to be is the top-left corner ↖"));
  parts.push(text(PX0, P1_TOP - 8, 11, 400, c.ink2, "↑ Good-move rate (higher is better)"));

  for (const pct of [0, 25, 50, 75, 100]) {
    const y = yOf(pct);
    parts.push(`<line x1="${PX0}" y1="${y}" x2="${PX1}" y2="${y}" stroke="${pct === 0 ? c.axis : c.grid}" stroke-width="1"/>`);
    parts.push(text(PX0 - 8, y + 4, 11, 400, c.muted, `${pct}%`, 'text-anchor="end"'));
  }

  const points = rows.filter((m) => m.goodMoveRate !== null && m.medianMs !== null && m.medianMs > 0);
  if (points.length === 0) {
    parts.push(text(PX0 + 12, P1_TOP + P1_H / 2, 12, 400, c.muted, "No graded answers in these logs"));
    return parts;
  }
  const [lo, hi] = timeDomain(points.map((m) => m.medianMs ?? 0));
  const xOf = (ms: number) => PX0 + ((Math.log10(ms) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (PX1 - PX0);
  for (const tick of TIME_TICKS.filter((t) => t >= lo && t <= hi)) {
    const x = xOf(tick).toFixed(1);
    parts.push(`<line x1="${x}" y1="${P1_TOP}" x2="${x}" y2="${P1_BOT}" stroke="${c.grid}" stroke-width="1"/>`);
    parts.push(text(x, P1_BOT + 18, 11, 400, c.muted, duration(tick), 'text-anchor="middle"'));
  }
  parts.push(text(PX0, P1_BOT + 38, 11, 400, c.ink2, "← Typical answer time, log scale (faster is better)"));

  // Labels go right of their point; one that would overlap a label already placed moves down a line.
  const placed: { x: number; y: number; w: number }[] = [];
  const ordered = [...points].sort((a, b) => (b.goodMoveRate ?? 0) - (a.goodMoveRate ?? 0));
  for (const m of ordered) {
    const kind = kindOf(m);
    const x = xOf(m.medianMs ?? 0);
    const y = yOf(m.goodMoveRate ?? 0);
    const tip = `${esc(rowLabel(m))}: ${Math.round(m.goodMoveRate ?? 0)}% good moves, ${duration(m.medianMs ?? 0)}`;
    parts.push(marker(kind, x, y, POINT_R, c[kind], tip));
    const label = rowLabel(m);
    const w = Array.from(label).length * CHAR_W;
    const lx = x + POINT_R + 6;
    let ly = y + 4;
    while (placed.some((p) => Math.abs(p.y - ly) < 14 && lx < p.x + p.w && p.x < lx + w)) ly += 14;
    placed.push({ x: lx, y: ly, w });
    parts.push(text(lx.toFixed(1), ly, 12, 400, c.ink, label));
  }
  return parts;
}

/** Part 2: pieces placed in time per live game, with the share of answers that came too late. */
function bars(rows: ModelSummary[], top: number, c: Palette): string[] {
  const parts: string[] = [];
  parts.push(text(24, top - 44, 14, 600, c.ink, "2 · Pieces placed in time"));
  parts.push(
    text(24, top - 28, 11, 400, c.muted, "Average per Live game: the piece went where the model chose, before it landed. Higher is better ↑"),
  );
  const sorted = [...rows].sort((a, b) => (b.realtimeLanded ?? -1) - (a.realtimeLanded ?? -1));
  const widest = Math.max(0, ...sorted.map((m) => (m.realtimeLanded === null ? 0 : Array.from(landedLabel(m)).length)));
  const span = W - 24 - BAR_X0 - Math.max(MIN_VALUE_ROOM, Math.ceil(widest * CHAR_W) + 10);
  const max = Math.max(0, ...sorted.map((m) => m.realtimeLanded ?? 0));
  parts.push(`<line x1="${BAR_X0}" y1="${top - 6}" x2="${BAR_X0}" y2="${top + sorted.length * ROW_H - 10}" stroke="${c.axis}" stroke-width="1"/>`);
  sorted.forEach((m, i) => {
    const y = top + i * ROW_H;
    parts.push(text(LABEL_W, y + BAR_H / 2 + 4, 13, 400, c.ink, rowLabel(m), 'text-anchor="end"'));
    if (m.realtimeLanded === null) {
      parts.push(text(BAR_X0 + 6, y + BAR_H / 2 + 4, 12, 400, c.muted, "—"));
      return;
    }
    const w = m.realtimeLanded > 0 && max > 0 ? Math.max(2, (m.realtimeLanded / max) * span) : 0;
    const title = `${esc(rowLabel(m))}: ${esc(landedLabel(m))}`;
    parts.push(`<rect x="${BAR_X0}" y="${y}" width="${w.toFixed(1)}" height="${BAR_H}" rx="4" fill="${c[kindOf(m)]}"><title>${title}</title></rect>`);
    parts.push(text((BAR_X0 + w + 6).toFixed(1), y + BAR_H / 2 + 4, 12, 400, c.ink2, landedLabel(m)));
  });
  return parts;
}

function landedLabel(m: ModelSummary): string {
  const landed = Math.round((m.realtimeLanded ?? 0) * 10) / 10;
  const late = m.tooLate !== null && m.tooLate >= 1 ? ` · ${Math.round(m.tooLate)}% too late` : "";
  return `${Number.isInteger(landed) ? landed : landed.toFixed(1)}${late}`;
}

function yOf(pct: number): number {
  return P1_BOT - (pct / 100) * P1_H;
}

/** The answer-time axis: the nearest ticks a step beyond the fastest and slowest answers, so no mark sits on an edge. */
function timeDomain(values: number[]): [number, number] {
  const min = Math.min(...values) / 1.3;
  const max = Math.max(...values) * 1.3;
  const lo = [...TIME_TICKS].reverse().find((t) => t <= min) ?? TIME_TICKS[0];
  const hi = TIME_TICKS.find((t) => t >= max) ?? TIME_TICKS[TIME_TICKS.length - 1];
  return [lo, hi > lo ? hi : lo * 10];
}

function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
}

/** A circle for a decision model, a square for a language model, so the kind never rests on colour alone. */
function marker(kind: Kind, x: number, y: number, r: number, fill: string, tip?: string): string {
  const title = tip === undefined ? "" : `<title>${tip}</title>`;
  const end = title ? `>${title}</${kind === "decision" ? "circle" : "rect"}>` : "/>";
  if (kind === "decision") return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}"${end}`;
  const s = r * 1.8;
  return `<rect x="${(x - s / 2).toFixed(1)}" y="${(y - s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" rx="2" fill="${fill}"${end}`;
}

function kindOf(m: ModelSummary): Kind {
  return m.kind === "system-one" ? "decision" : "language";
}

/** The label of a model: a mock row keeps its (mock) tag, cutting the name to make room for it. */
function rowLabel(m: ModelSummary): string {
  return m.mock ? `${shortLabel(m.label, LABEL_MAX - MOCK_TAG.length)}${MOCK_TAG}` : shortLabel(m.label, LABEL_MAX);
}

/** Lines of at most `max` characters, breaking only between " · " clauses. */
function wrap(clauses: string[], max: number): string[] {
  const lines: string[] = [];
  for (const clause of clauses) {
    const last = lines.at(-1);
    if (last !== undefined && Array.from(`${last} · ${clause}`).length <= max) lines[lines.length - 1] = `${last} · ${clause}`;
    else lines.push(clause);
  }
  return lines;
}

function footer(summary: BenchSummary, rows: ModelSummary[]): string[] {
  const id = summary.environment.split(" ")[0];
  const clauses = [ENVIRONMENTS[id] ?? summary.environment, "every model gets the same pieces"];
  const live = summary.games.realtime;
  const paused = summary.games.frozen;
  if (live > 0) {
    const limit = summary.realtimeSeconds === null ? "" : `, up to ${gameLength(summary.realtimeSeconds)} each`;
    clauses.push(`Live: ${games(live)}${limit}`);
  }
  if (paused > 0) clauses.push(`Paused: ${games(paused)}${summary.frozenPieces === null ? "" : `, ${summary.frozenPieces} pieces each`}`);
  if (rows.some((m) => m.goodMovesFrom === "frozen")) clauses.push("good-move rate from Paused games");
  else if (rows.some((m) => m.goodMovesFrom === "realtime")) clauses.push("good-move rate from every Live answer, late or not");
  clauses.push(`total cost $${summary.totalCostUsd.toFixed(2)}`);
  const left = summary.skipped.length;
  if (left > 0) clauses.push(`${left} unfinished ${left === 1 ? "game" : "games"} left out`);
  clauses.push(summary.date, "no confidence intervals yet");
  return clauses;
}

function games(n: number): string {
  return `${n} ${n === 1 ? "game" : "games"}`;
}

/** A live game's time limit in words; whole minutes read as minutes. */
function gameLength(seconds: number): string {
  const whole = seconds % 60 === 0;
  const n = whole ? seconds / 60 : seconds;
  const unit = whole ? "minute" : "second";
  return `${n} ${n === 1 ? unit : `${unit}s`}`;
}

function shortLabel(label: string, max: number): string {
  const chars = Array.from(label);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : label;
}

function text(x: number | string, y: number, size: number, weight: number, fill: string, content: string, extra = ""): string {
  const w = weight === 400 ? "" : ` font-weight="${weight}"`;
  const anchor = extra ? ` ${extra}` : "";
  return `<text x="${x}" y="${y}" font-size="${size}"${w}${anchor} fill="${fill}">${esc(content)}</text>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
