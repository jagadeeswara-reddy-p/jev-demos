import { describe, expect, test } from "bun:test";
import { type ChartPart, type ChartTheme, renderChart } from "./chart";
import type { BenchSummary, ModelSummary } from "./results";

function model(overrides: Partial<ModelSummary> & Pick<ModelSummary, "id" | "label" | "kind">): ModelSummary {
  return {
    seeds: 2,
    goodMoveRate: 50,
    goodMovesFrom: "frozen",
    frozenLines: 10,
    medianMs: 500,
    realtimeLanded: 10,
    tooLate: 0,
    costUsd: 0.1,
    mock: false,
    ...overrides,
  };
}

/** Both charts, one after the other, for checks that look at either. */
function both(summary: BenchSummary, theme: ChartTheme): string {
  return renderChart(summary, theme, "choices") + renderChart(summary, theme, "pieces");
}

/** The footer's lines, joined back into one " · " list. */
function footerText(svg: string): string {
  const height = Number(svg.match(/height="(\d+)"/)?.[1]);
  return [...svg.matchAll(/<text x="24" y="(\d+)" font-size="11" fill="[^"]+">([^<]*)<\/text>/g)]
    .filter((m) => Number(m[1]) > height - 60)
    .map((m) => m[2])
    .join(" · ");
}

/** Four models: one decision model, two language models, one reference. */
function fixture(overrides: Partial<BenchSummary> = {}): BenchSummary {
  return {
    name: "demo",
    environment: "tetris v3",
    seeds: 2,
    frozenPieces: 30,
    realtimeSeconds: 120,
    games: { frozen: 2, realtime: 2 },
    totalCostUsd: 2.4216,
    skipped: [],
    date: "2026-10-28",
    models: [
      model({ id: "jev", label: "Jev", kind: "system-one", goodMoveRate: 60, medianMs: 310, realtimeLanded: 88, costUsd: 0.12 }),
      model({ id: "a", label: "Language Model A", kind: "llm", goodMoveRate: 82, medianMs: 2300, realtimeLanded: 21.5, tooLate: 40, costUsd: 1.5 }),
      model({ id: "b", label: "Model B", kind: "llm", goodMoveRate: 64, medianMs: 1200, realtimeLanded: 9, tooLate: 70, costUsd: 0.8 }),
      model({ id: "h", label: "Heuristic", kind: "baseline", goodMoveRate: 100, medianMs: 1, realtimeLanded: 4, costUsd: 0 }),
    ],
    ...overrides,
  };
}

/** Titled bars as [width, title], in document order. */
function bars(svg: string): [number, string][] {
  return [...svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="16" rx="4"[^>]*><title>([^<]*)<\/title>/g)].map((m) => [
    Number(m[1]),
    m[2] ?? "",
  ]);
}

/** Scatter marks as {x, y, title}: circles and squares that carry a tooltip. */
function marks(svg: string): { x: number; y: number; title: string }[] {
  const circles = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="7"[^>]*><title>([^<]*)<\/title>/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    title: m[3],
  }));
  const squares = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="12.6" height="12.6"[^>]*><title>([^<]*)<\/title>/g)].map((m) => ({
    x: Number(m[1]) + 6.3,
    y: Number(m[2]) + 6.3,
    title: m[3],
  }));
  return [...circles, ...squares];
}

function markOf(svg: string, name: string) {
  const found = marks(svg).find((m) => m.title.startsWith(`${name}:`));
  if (!found) throw new Error(`no mark for ${name}`);
  return found;
}

describe("renderChart", () => {
  test("each part is its own svg, with role img and its own title", () => {
    const parts: [ChartPart, string][] = [
      ["choices", "Good choices vs. fast answers"],
      ["pieces", "Pieces placed in time"],
    ];
    for (const [part, title] of parts) {
      const svg = renderChart(fixture(), "light", part);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.match(/<svg /g)).toHaveLength(1);
      expect(svg).toContain('role="img"');
      expect(svg).toContain(`>${title}</text>`);
    }
  });

  test("the choices part has the marks and no bars, and the pieces part the reverse", () => {
    const choices = renderChart(fixture(), "light", "choices");
    const pieces = renderChart(fixture(), "light", "pieces");
    expect(marks(choices)).toHaveLength(3);
    expect(bars(choices)).toHaveLength(0);
    expect(marks(pieces)).toHaveLength(0);
    expect(bars(pieces)).toHaveLength(3);
  });

  test("leaves the heuristic baseline out of both parts", () => {
    const svg = both(fixture(), "light");
    expect(svg).not.toContain("Heuristic");
    expect(marks(svg)).toHaveLength(3);
    expect(bars(svg)).toHaveLength(3);
  });

  test("every axis says which way is better", () => {
    const svg = both(fixture(), "light");
    expect(svg).toContain("↑ Good-move rate (higher is better)");
    expect(svg).toContain("← Typical answer time, log scale (faster is better)");
    expect(svg).toContain("Higher is better.");
    expect(svg).toContain("top-left corner ↖");
  });

  test("light uses the light background and not the dark one, and dark the reverse", () => {
    const light = both(fixture(), "light");
    const dark = both(fixture(), "dark");
    expect(light).toContain("#fcfcfb");
    expect(light).not.toContain("#1a1a19");
    expect(dark).toContain("#1a1a19");
    expect(dark).not.toContain("#fcfcfb");
  });

  test("the two themes have the same layout once colours are removed", () => {
    const strip = (s: string) => s.replace(/#[0-9a-f]{6}/g, "#");
    expect(strip(both(fixture(), "light"))).toBe(strip(both(fixture(), "dark")));
  });

  test("a decision model is a circle and a language model a square", () => {
    const svg = both(fixture(), "light");
    expect(svg).toMatch(/<circle [^>]*><title>Jev: 60% good moves, 310 ms<\/title>/);
    expect(svg).toMatch(/<rect [^>]*width="12.6"[^>]*><title>Model B: 64% good moves, 1.2 s<\/title>/);
  });

  test("a higher good-move rate sits higher, and a faster answer further left", () => {
    const svg = both(fixture(), "light");
    const jev = markOf(svg, "Jev");
    const a = markOf(svg, "Language Model A");
    const b = markOf(svg, "Model B");
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(jev.y);
    expect(jev.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(a.x);
  });

  test("answer time is on a log scale: equal ratios take equal widths", () => {
    const summary = fixture({
      models: [
        model({ id: "x", label: "X", kind: "llm", medianMs: 300 }),
        model({ id: "y", label: "Y", kind: "llm", medianMs: 600 }),
        model({ id: "z", label: "Z", kind: "llm", medianMs: 1200 }),
      ],
    });
    const svg = both(summary, "light");
    const [x, y, z] = ["X", "Y", "Z"].map((n) => markOf(svg, n).x);
    expect(Math.abs(y - x - (z - y))).toBeLessThan(0.2);
  });

  test("labels of nearby marks do not overlap", () => {
    const summary = fixture({
      models: [
        model({ id: "s", label: "Strands Decider", kind: "system-one", goodMoveRate: 15, medianMs: 435 }),
        model({ id: "l", label: "Laya", kind: "system-one", goodMoveRate: 13, medianMs: 452 }),
      ],
    });
    const svg = both(summary, "light");
    const ys = ["Strands Decider", "Laya"].map((n) => Number(svg.match(new RegExp(`y="([\\d.]+)" font-size="12" fill="[^"]+">${n}</text>`))?.[1]));
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThanOrEqual(14);
  });

  test("a model without a good-move rate gets a bar but no mark", () => {
    const summary = fixture({ models: fixture().models.map((m) => ({ ...m, goodMoveRate: null, goodMovesFrom: null })) });
    const svg = both(summary, "light");
    expect(marks(svg)).toHaveLength(0);
    expect(svg).toContain("No graded answers in these logs");
    expect(bars(svg)).toHaveLength(3);
  });

  test("bars are sorted by pieces placed, and their widths are proportional", () => {
    const found = bars(both(fixture(), "light"));
    expect(found.map(([, t]) => t.split(":")[0])).toEqual(["Jev", "Language Model A", "Model B"]);
    expect(Math.abs(found[1][0] / found[0][0] - 21.5 / 88)).toBeLessThan(0.01);
  });

  test("a bar's value shows the late share when at least 1% came too late", () => {
    const svg = both(fixture(), "light");
    expect(svg).toContain("21.5 · 40% too late");
    expect(svg).toContain(">88</text>");
  });

  test("a long label is truncated to 19 characters and an ellipsis", () => {
    const long = `${"x".repeat(20)}${"y".repeat(20)}`;
    const svg = both(fixture({ models: [model({ id: "long", label: long, kind: "llm" })] }), "light");
    expect(svg).toContain(`${"x".repeat(19)}…`);
    expect(svg).not.toContain(`>${long}</text>`);
  });

  test("labels are XML-escaped", () => {
    const svg = both(fixture({ models: [model({ id: "x", label: "<script>x</script>", kind: "llm" })] }), "light");
    expect(svg).not.toContain("<script>x");
    expect(svg).toContain("&lt;script&gt;x");
  });

  test("every text fits even in a wide fallback font (0.6 em per character)", () => {
    const wide = fixture({ seeds: 12, realtimeSeconds: 100, totalCostUsd: 123.45, skipped: ["a.jsonl", "b.jsonl"] });
    for (const theme of ["light", "dark"] as const) {
      const svg = both(wide, theme);
      const texts = [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-size="(\d+)"([^>]*)>([^<]*)<\/text>/g)].map((m) => ({
        x: Number(m[1]),
        anchored: m[3].includes("text-anchor"),
        width: Array.from(m[4].replace(/&[a-z#0-9]+;/g, "_")).length * 0.6 * Number(m[2]),
      }));
      for (const t of texts) if (!t.anchored) expect(t.x + t.width).toBeLessThanOrEqual(876);
    }
  });

  test("the footer says what was played, in plain words", () => {
    expect(footerText(renderChart(fixture(), "light", "pieces"))).toBe(
      "Deadline Tetris · 2 Live games, up to 2 minutes each · 2 Paused games, 30 pieces each · no error bars yet",
    );
  });

  test("with only live games, the footer counts the live games and leaves Paused out", () => {
    const summary = fixture({
      frozenPieces: null,
      games: { frozen: 0, realtime: 4 },
      realtimeSeconds: 600,
      models: [model({ id: "jev", label: "Jev", kind: "system-one", goodMovesFrom: "realtime" })],
    });
    const text = footerText(renderChart(summary, "light", "pieces"));
    expect(text).toBe("Deadline Tetris · 4 Live games, up to 10 minutes each · no error bars yet");
  });

  test("a live limit that is not whole minutes reads in seconds", () => {
    expect(footerText(renderChart(fixture({ realtimeSeconds: 100 }), "light", "pieces"))).toContain("up to 100 seconds each");
  });

  test("the footer names the unfinished games left out, and says nothing when there are none", () => {
    expect(footerText(renderChart(fixture({ skipped: ["a.jsonl", "b.jsonl"] }), "light", "pieces"))).toContain("· 2 unfinished games left out ·");
    expect(footerText(renderChart(fixture({ skipped: ["a.jsonl"] }), "light", "pieces"))).toContain("· 1 unfinished game left out ·");
    expect(both(fixture(), "light")).not.toContain("left out");
  });

  test("the legend shows only the kinds present", () => {
    const svg = both(fixture({ models: [model({ id: "a", label: "Model A", kind: "llm" })] }), "light");
    expect(svg).toContain("Language model");
    expect(svg).not.toContain("Decision model");
  });

  test("a mock model's label and tooltip say (mock), cutting a long name before the tag", () => {
    const svg = both(fixture({ models: [model({ id: "m", label: "Fast LLM", kind: "llm", mock: true })] }), "light");
    expect(svg).toContain(">Fast LLM (mock)</text>");
    expect(svg).toContain("<title>Fast LLM (mock): 50% good moves, 500 ms</title>");
    const long = both(fixture({ models: [model({ id: "m", label: "x".repeat(40), kind: "llm", mock: true })] }), "light");
    expect(long).toContain(`>${"x".repeat(12)}… (mock)</text>`);
  });

  test("the chart carries no date", () => {
    expect(both(fixture(), "light")).not.toContain("2026-10-28");
  });

  test("is deterministic for the same input", () => {
    expect(both(fixture(), "dark")).toBe(both(fixture(), "dark"));
  });
});
