import type { BenchSummary, ModelSummary } from "./results";

// Renders the bench results as one self-contained SVG (light or dark). Ported from the
// approved prototype: same palette, same layout constants, same three panels.

export type ChartTheme = "light" | "dark";

interface Palette {
  bg: string;
  ink: string;
  ink2: string;
  muted: string;
  axis: string;
  decision: string;
  language: string;
  reference: string;
}

const PALETTES: Record<ChartTheme, Palette> = {
  light: {
    bg: "#fcfcfb",
    ink: "#0b0b0b",
    ink2: "#52514e",
    muted: "#898781",
    axis: "#c3c2b7",
    decision: "#2a78d6",
    language: "#eb6834",
    reference: "#b5b3ab",
  },
  dark: {
    bg: "#1a1a19",
    ink: "#f0efec",
    ink2: "#c3c2b7",
    muted: "#898781",
    axis: "#383835",
    decision: "#3987e5",
    language: "#d95926",
    reference: "#5c5b57",
  },
};

const W = 880;
const LABEL_W = 150;
const GAP = 28;
const PANEL_W = (W - LABEL_W - 24 - GAP * 2) / 3;
const TOP = 112;
const ROW_H = 34;
const BAR_H = 16;
/** Smallest room kept to the right of a panel's longest bar for its value labels. */
const MIN_VALUE_ROOM = 70;
/** Approximate advance of one character of the 12 px value labels. */
const CHAR_W = 6.6;
const LABEL_MAX = 20;
/** Marks a mock row when chart drew it (--allow-mock). Baselines are never marked. */
const MOCK_TAG = " (mock)";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Liberation Sans', sans-serif";
/** Widest likely glyph, as a share of the font size: text is laid out so a wide fallback font still fits. */
const WIDE = 0.6;
const FOOTER_LINE = 16;
const ARIA = "Benchmark comparison: judgement, speed and pieces landed in real time";
const TITLE = "Judgement, speed and the live game";

/** The palette key for each kind of row. */
type Kind = keyof Palette;

const LEGEND: [Kind, string][] = [
  ["decision", "Decision model"],
  ["language", "Language model"],
  ["reference", "Reference (heuristic)"],
];

interface Panel {
  title: string;
  sub: string;
  /** Scale maximum; the bars are drawn from 0 to this value. */
  max: (rows: ModelSummary[]) => number;
  value: (m: ModelSummary) => number | null;
  fmt: (m: ModelSummary) => string;
}

/** A real-time limit in words: "2-minute" before a noun and "2 minutes" on its own; whole minutes read as minutes. */
interface GameLength {
  adjective: string;
  plain: string;
}

function gameLength(seconds: number): GameLength {
  const minutes = seconds % 60 === 0;
  const n = minutes ? seconds / 60 : seconds;
  const unit = minutes ? "minute" : "second";
  return { adjective: `${n}-${unit}`, plain: `${n} ${n === 1 ? unit : `${unit}s`}` };
}

function panelsFor(game: GameLength | null): Panel[] {
  return [
    {
      title: "Judgement",
      sub: "Agreement with heuristic (frozen)",
      max: () => 100,
      value: (m) => m.agreement,
      fmt: (m) => `${Math.round(m.agreement ?? 0)}%`,
    },
    {
      title: "Speed",
      sub: "Median answer (shorter is faster)",
      max: (rows) => largest(rows.map((m) => m.medianMs)),
      value: (m) => m.medianMs,
      fmt: (m) => {
        const ms = m.medianMs ?? 0;
        return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
      },
    },
    {
      title: "Real time",
      sub: game === null ? "Pieces landed per game" : `Pieces landed, ${game.adjective} game`,
      max: (rows) => largest(rows.map((m) => m.realtimeLanded)),
      value: (m) => m.realtimeLanded,
      fmt: (m) => {
        const landed = Math.round((m.realtimeLanded ?? 0) * 10) / 10;
        const late = m.tooLate !== null && m.tooLate >= 1 ? ` · ${Math.round(m.tooLate)}% late` : "";
        return `${Number.isInteger(landed) ? landed : landed.toFixed(1)}${late}`;
      },
    },
  ];
}

/** One self-contained SVG: title, legend, three bar panels, footer. Pure: same input, same string. */
export function renderChart(summary: BenchSummary, theme: ChartTheme): string {
  const c = PALETTES[theme];
  const rows = summary.models;
  const game = summary.realtimeSeconds === null ? null : gameLength(summary.realtimeSeconds);
  const notes = wrap(footer(summary, game), Math.floor((W - 48) / (11 * WIDE)));
  const H = TOP + rows.length * ROW_H + 36 + (notes.length - 1) * FOOTER_LINE;
  const present = new Set(rows.map(kindOf));

  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" rx="8" fill="${c.bg}"/>`);
  parts.push(text(24, 36, 18, 600, c.ink, TITLE));

  let lx = 24;
  for (const [kind, name] of LEGEND) {
    if (!present.has(kind)) continue;
    parts.push(`<rect x="${lx}" y="50" width="12" height="12" rx="3" fill="${c[kind]}"/>`);
    parts.push(text(lx + 18, 60, 12, 400, c.ink2, name));
    lx += 18 + name.length * 6.6 + 22;
  }

  rows.forEach((m, i) => {
    const y = TOP + i * ROW_H;
    parts.push(text(LABEL_W, y + BAR_H / 2 + 4, 13, 400, c.ink, rowLabel(m), 'text-anchor="end"'));
  });

  panelsFor(game).forEach((p, k) => {
    const x0 = LABEL_W + 24 + k * (PANEL_W + GAP);
    // Leave room for this panel's widest value label, so it stays inside the chart.
    const widest = Math.max(0, ...rows.map((m) => (p.value(m) === null ? 0 : Array.from(p.fmt(m)).length)));
    const span = PANEL_W - Math.max(MIN_VALUE_ROOM, Math.ceil(widest * CHAR_W) + 10);
    parts.push(text(x0, TOP - 30, 14, 600, c.ink, p.title));
    parts.push(text(x0, TOP - 14, 11, 400, c.muted, p.sub));
    parts.push(`<line x1="${x0}" y1="${TOP - 6}" x2="${x0}" y2="${TOP + rows.length * ROW_H - 10}" stroke="${c.axis}" stroke-width="1"/>`);
    const max = p.max(rows);
    rows.forEach((m, i) => {
      const y = TOP + i * ROW_H;
      const value = p.value(m);
      if (value === null) {
        parts.push(text(x0 + 6, y + BAR_H / 2 + 4, 12, 400, c.muted, "—"));
        return;
      }
      const w = value > 0 && max > 0 ? Math.max(2, (value / max) * span) : 0;
      const title = `${esc(m.label)}${isMockRow(m) ? MOCK_TAG : ""}: ${esc(p.fmt(m))}`;
      parts.push(`<rect x="${x0}" y="${y}" width="${w.toFixed(1)}" height="${BAR_H}" rx="4" fill="${c[kindOf(m)]}"><title>${title}</title></rect>`);
      parts.push(text((x0 + w + 6).toFixed(1), y + BAR_H / 2 + 4, 12, 400, c.ink2, p.fmt(m)));
    });
  });

  notes.forEach((line, i) => {
    parts.push(text(24, H - 14 - (notes.length - 1 - i) * FOOTER_LINE, 11, 400, c.muted, line));
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" role="img" aria-label="${esc(ARIA)}">\n${parts.join("\n")}\n</svg>\n`;
}

function kindOf(m: ModelSummary): Kind {
  if (m.kind === "system-one") return "decision";
  if (m.kind === "baseline") return "reference";
  return "language";
}

/** A mock model drawn with --allow-mock. Baselines are reference rows, so they are never marked. */
function isMockRow(m: ModelSummary): boolean {
  return m.mock && m.kind !== "baseline";
}

/** The label column: a mock row keeps its (mock) tag, cutting the name to make room for it. */
function rowLabel(m: ModelSummary): string {
  return isMockRow(m) ? `${shortLabel(m.label, LABEL_MAX - MOCK_TAG.length)}${MOCK_TAG}` : shortLabel(m.label, LABEL_MAX);
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

function footer(summary: BenchSummary, game: GameLength | null): string[] {
  const clauses = [summary.environment, `${summary.seeds} ${summary.seeds === 1 ? "seed" : "seeds"}`];
  if (summary.frozenPieces !== null) clauses.push(`frozen: ${summary.frozenPieces} pieces each`);
  if (game !== null) clauses.push(`real time: ${game.plain}`);
  clauses.push(`total cost $${summary.totalCostUsd.toFixed(2)}`);
  const left = summary.skipped.length;
  if (left > 0) clauses.push(`${left} unfinished ${left === 1 ? "match" : "matches"} left out`);
  clauses.push(summary.date, "no confidence intervals yet");
  return clauses;
}

function shortLabel(label: string, max: number): string {
  const chars = Array.from(label);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : label;
}

function largest(values: (number | null)[]): number {
  return Math.max(0, ...values.map((v) => v ?? 0));
}

function text(x: number | string, y: number, size: number, weight: number, fill: string, content: string, extra = ""): string {
  const w = weight === 400 ? "" : ` font-weight="${weight}"`;
  const anchor = extra ? ` ${extra}` : "";
  return `<text x="${x}" y="${y}" font-size="${size}"${w}${anchor} fill="${fill}">${esc(content)}</text>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
