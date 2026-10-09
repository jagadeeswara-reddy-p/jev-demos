import { HIDDEN_ROWS, VISIBLE_HEIGHT, WIDTH } from "../engine/board";
import { SHAPES, type Cell, type PieceType } from "../engine/pieces";
import { fmtSeconds, type BoardState } from "./store";

// Draws one board as a technical figure: dot grid, line-art blocks in the ink
// ramp, dashed outlines for the options a model weighed, and callout labels
// with arrows in the gutter, like the parts labels in a manual illustration.

export const GUTTER_CELLS = 5;
export const GAP_CELLS = 0.8;
export const WIDTH_CELLS = WIDTH + GAP_CELLS + GUTTER_CELLS;

interface Theme {
  sheet: string;
  ink: string;
  inkDeep: string;
  inkSoft: string;
  inkFaint: string;
  dot: string;
  text: string;
  muted: string;
  piece: Record<string, string>;
}

let cachedTheme: Theme | null = null;
let cachedAt = 0;

/** Re-read the colour tokens on the next frame, e.g. after the theme changes. */
export function refreshCanvasTheme() {
  cachedTheme = null;
}

function theme(): Theme {
  const now = performance.now();
  if (cachedTheme && now - cachedAt < 500) return cachedTheme;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  cachedTheme = {
    sheet: v("--sheet"),
    ink: v("--ink"),
    inkDeep: v("--ink-deep"),
    inkSoft: v("--ink-soft"),
    inkFaint: v("--ink-faint"),
    dot: v("--dot"),
    text: v("--text"),
    muted: v("--muted"),
    piece: Object.fromEntries(["I", "J", "L", "O", "S", "T", "Z"].map((p) => [p, v(`--piece-${p}`)])),
  };
  cachedAt = now;
  return cachedTheme;
}

export function drawBoard(ctx: CanvasRenderingContext2D, cell: number, b: BoardState | undefined, finishedAt: number | null) {
  const th = theme();
  const W = WIDTH * cell;
  const H = VISIBLE_HEIGHT * cell;
  const gx = W + GAP_CELLS * cell;
  const mono = (px: number) => `${Math.max(9, Math.round(px))}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.clearRect(0, 0, WIDTH_CELLS * cell, H + 1);

  // Sheet and frame.
  ctx.fillStyle = th.sheet;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = th.dot;
  const d = Math.max(1, Math.round(cell / 14));
  for (let x = 1; x < WIDTH; x++) for (let y = 1; y < VISIBLE_HEIGHT; y++) ctx.fillRect(x * cell - d / 2, y * cell - d / 2, d, d);
  ctx.strokeStyle = th.inkSoft;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  if (!b) return;

  const block = (x: number, y: number, type: string, strong = false) => {
    const vy = y - HIDDEN_ROWS;
    if (vy < 0) return;
    const px = x * cell;
    const py = vy * cell;
    ctx.fillStyle = th.piece[type] ?? th.ink;
    ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
    ctx.strokeStyle = strong ? th.inkDeep : th.ink;
    ctx.lineWidth = strong ? 1.5 : 1;
    ctx.strokeRect(px + 1.5, py + 1.5, cell - 3, cell - 3);
  };

  // Locked stack.
  for (let y = HIDDEN_ROWS; y < HIDDEN_ROWS + VISIBLE_HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const c = b.board[y * WIDTH + x];
      if (c !== ".") block(x, y, c);
    }
  }

  // Line clear flash.
  if (b.flash) {
    const age = performance.now() - b.flash.wall;
    if (age < 320) {
      ctx.fillStyle = th.ink;
      ctx.globalAlpha = 0.55 * (1 - age / 320);
      for (const r of b.flash.rows) ctx.fillRect(0, (r - HIDDEN_ROWS) * cell, W, cell);
      ctx.globalAlpha = 1;
    }
  }

  // What the model weighed for the last piece: alternatives dashed, the pick solid.
  const callouts: { y: number; anchor: [number, number]; title: string; sub: string; strong: boolean }[] = [];
  const ann = b.annotation;
  if (ann && b.lastLock && ann.pieceId === b.lastLock.pieceId) {
    for (const alt of ann.alternatives) {
      outline(ctx, alt.candidate.cells, cell, th.inkSoft, [4, 3], 1.25);
      callouts.push({
        y: centerY(alt.candidate.cells, cell),
        anchor: rightEdge(alt.candidate.cells, cell),
        title: alt.candidate.id,
        sub: pct(alt.p),
        strong: false,
      });
    }
    outline(ctx, b.lastLock.cells, cell, th.inkDeep, [], 2);
    if (ann.chosen) {
      callouts.push({
        y: centerY(b.lastLock.cells, cell),
        anchor: rightEdge(b.lastLock.cells, cell),
        title: ann.chosen.id,
        sub: ann.chosenP !== null ? `${pct(ann.chosenP)} chosen` : "chosen",
        strong: true,
      });
    }
  }

  // Active piece.
  if (b.active) for (const [x, y] of b.active.cells) block(x, y, b.active.type, true);

  // Gutter: next pieces.
  ctx.fillStyle = th.ink;
  ctx.font = mono(cell * 0.42);
  ctx.textBaseline = "top";
  ctx.fillText("NEXT", gx, 0);
  const mini = cell * 0.42;
  let ny = cell * 0.9;
  for (const type of b.next.slice(0, 3)) {
    drawMini(ctx, type, gx, ny, mini, th);
    ny += mini * 3;
  }
  const calloutTop = ny + cell * 0.4;

  // Gutter: callouts, kept apart vertically, each with an arrow to its piece.
  callouts.sort((a, c) => a.y - c.y);
  const lineH = cell * 1.25;
  // Push labels down so none overlap, then back up from the bottom edge so the
  // last ones still fit; near the floor several pieces can share one row.
  const ys: number[] = [];
  let floor = calloutTop;
  for (const c of callouts) {
    ys.push(Math.max(c.y, floor));
    floor = ys[ys.length - 1] + lineH;
  }
  let ceiling = H - lineH;
  for (let i = ys.length - 1; i >= 0; i--) {
    ys[i] = Math.min(ys[i], ceiling);
    ceiling = ys[i] - lineH;
  }
  for (const [i, c] of callouts.entries()) {
    const ly = ys[i];
    const lx = gx + cell * 0.9;
    ctx.strokeStyle = c.strong ? th.ink : th.inkSoft;
    ctx.lineWidth = 1;
    ctx.setLineDash(c.strong ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(lx - cell * 0.2, ly + cell * 0.25);
    ctx.lineTo(c.anchor[0] + cell * 0.25, c.anchor[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    arrowHead(ctx, c.anchor[0] + cell * 0.25, c.anchor[1], lx - cell * 0.2, ly + cell * 0.25, cell * 0.22, c.strong ? th.ink : th.inkSoft);
    ctx.fillStyle = c.strong ? th.ink : th.muted;
    ctx.font = mono(cell * 0.4);
    ctx.fillText(c.title.replace("option_", "OPT ").toUpperCase(), lx, ly);
    ctx.font = mono(cell * 0.36);
    ctx.fillText(c.sub, lx, ly + cell * 0.48);
  }

  // End of game stamp.
  if (b.outAt !== null) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    if (!b.survived) {
      ctx.strokeStyle = th.inkSoft;
      ctx.lineWidth = 1;
      for (let k = -H; k < W; k += 9) {
        ctx.beginPath();
        ctx.moveTo(k, H);
        ctx.lineTo(k + H, 0);
        ctx.stroke();
      }
    }
    ctx.restore();
    const sw = Math.min(W - cell, cell * 8.4);
    const sh = cell * 2.6;
    const sx = (W - sw) / 2;
    const sy = H * 0.42;
    ctx.fillStyle = th.sheet;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx + 0.75, sy + 0.75, sw - 1.5, sh - 1.5);
    ctx.fillStyle = th.ink;
    ctx.textAlign = "center";
    ctx.font = `${Math.round(cell * 0.78)}px "Silkscreen", ui-monospace, monospace`;
    ctx.fillText(b.survived ? "SURVIVED" : "TOPPED OUT", W / 2, sy + cell * 0.45);
    ctx.fillStyle = th.muted;
    ctx.font = mono(cell * 0.4);
    const detail = b.survived
      ? `${b.stats.pieces} pieces, level ${b.outLevel}`
      : `at ${fmtSeconds(b.outAt)}, level ${b.outLevel}`;
    ctx.fillText(detail, W / 2, sy + cell * 1.55);
    ctx.textAlign = "left";
  } else if (finishedAt !== null) {
    ctx.fillStyle = th.muted;
    ctx.font = mono(cell * 0.42);
    ctx.textAlign = "center";
    ctx.fillText("still standing when the run ended", W / 2, cell * 0.5);
    ctx.textAlign = "left";
  }
}

function drawMini(ctx: CanvasRenderingContext2D, type: PieceType, x0: number, y0: number, size: number, th: Theme) {
  for (const [x, y] of SHAPES[type][0]) {
    const px = x0 + x * size;
    const py = y0 + y * size;
    ctx.fillStyle = th.piece[type];
    ctx.fillRect(px + 0.5, py + 0.5, size - 1, size - 1);
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
  }
}

/** Traces only the outer edges of a group of cells, so a piece reads as one shape. */
function outline(ctx: CanvasRenderingContext2D, cells: readonly Cell[], cell: number, color: string, dash: number[], width: number) {
  const set = new Set(cells.map(([x, y]) => `${x},${y}`));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  for (const [x, y] of cells) {
    const vy = y - HIDDEN_ROWS;
    if (vy < 0) continue;
    const l = x * cell;
    const t = vy * cell;
    const r = l + cell;
    const bm = t + cell;
    if (!set.has(`${x},${y - 1}`)) (ctx.moveTo(l, t), ctx.lineTo(r, t));
    if (!set.has(`${x},${y + 1}`)) (ctx.moveTo(l, bm), ctx.lineTo(r, bm));
    if (!set.has(`${x - 1},${y}`)) (ctx.moveTo(l, t), ctx.lineTo(l, bm));
    if (!set.has(`${x + 1},${y}`)) (ctx.moveTo(r, t), ctx.lineTo(r, bm));
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function centerY(cells: readonly Cell[], cell: number): number {
  const ys = cells.map(([, y]) => y - HIDDEN_ROWS);
  return ((Math.min(...ys) + Math.max(...ys) + 1) / 2) * cell - cell * 0.3;
}

function rightEdge(cells: readonly Cell[], cell: number): [number, number] {
  const maxX = Math.max(...cells.map(([x]) => x));
  const rowYs = cells.filter(([x]) => x === maxX).map(([, y]) => y - HIDDEN_ROWS);
  const y = (Math.min(...rowYs) + Math.max(...rowYs) + 1) / 2;
  return [(maxX + 1) * cell, y * cell];
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, fromX: number, fromY: number, size: number, color: string) {
  const a = Math.atan2(y - fromY, x - fromX);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * Math.cos(a - 0.45), y - size * Math.sin(a - 0.45));
  ctx.lineTo(x - size * Math.cos(a + 0.45), y - size * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}
