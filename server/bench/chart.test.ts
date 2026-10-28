import { describe, expect, test } from "bun:test";
import { renderChart } from "./chart";
import type { BenchSummary, ModelSummary } from "./results";

function model(overrides: Partial<ModelSummary> & Pick<ModelSummary, "id" | "label" | "kind">): ModelSummary {
  return {
    seeds: 2,
    agreement: 50,
    frozenLines: 10,
    medianMs: 500,
    realtimeLanded: 10,
    tooLate: 0,
    costUsd: 0.1,
    mock: false,
    ...overrides,
  };
}

/** Four models in row order: one decision model, two language models, one reference. */
function fixture(overrides: Partial<BenchSummary> = {}): BenchSummary {
  return {
    name: "demo",
    environment: "tetris v3",
    seeds: 2,
    frozenPieces: 30,
    realtimeSeconds: 120,
    totalCostUsd: 2.4216,
    skipped: [],
    date: "2026-10-28",
    models: [
      model({ id: "jev", label: "Jev", kind: "system-one", agreement: 100, medianMs: 310, realtimeLanded: 88, costUsd: 0.12 }),
      model({ id: "a", label: "Language Model A", kind: "llm", agreement: 82, medianMs: 2300, realtimeLanded: 21.5, tooLate: 40, costUsd: 1.5 }),
      model({ id: "b", label: "Model B", kind: "llm", agreement: 64, medianMs: 1200, realtimeLanded: 9, tooLate: 70, costUsd: 0.8 }),
      model({ id: "h", label: "Heuristic", kind: "baseline", agreement: 100, medianMs: 1, realtimeLanded: 4, costUsd: 0 }),
    ],
    ...overrides,
  };
}

/** Titled bars as [width, title], in document order. */
function bars(svg: string): [number, string][] {
  return [...svg.matchAll(/width="([\d.]+)"[^>]*><title>([^<]*)<\/title>/g)].map((m) => [Number(m[1]), m[2] ?? ""]);
}

function widthOf(svg: string, title: string): number {
  const found = bars(svg).find(([, t]) => t === title);
  if (!found) throw new Error(`no bar titled ${title}`);
  return found[0];
}

describe("renderChart", () => {
  test("starts with an svg element that has role img and every label", () => {
    const svg = renderChart(fixture(), "light");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="');
    for (const label of ["Jev", "Language Model A", "Model B", "Heuristic"]) expect(svg).toContain(label);
    expect(svg).toContain("Judgement, speed and the live game");
    expect(svg).toContain("Judgement");
    expect(svg).toContain("Speed");
    expect(svg).toContain("Real time");
  });

  test("light uses the light background and not the dark one, and dark the reverse", () => {
    const light = renderChart(fixture(), "light");
    const dark = renderChart(fixture(), "dark");
    expect(light).toContain("#fcfcfb");
    expect(light).not.toContain("#1a1a19");
    expect(dark).toContain("#1a1a19");
    expect(dark).not.toContain("#fcfcfb");
  });

  test("the two themes have the same layout once colours are removed", () => {
    const strip = (s: string) => s.replace(/#[0-9a-f]{6}/g, "#");
    expect(strip(renderChart(fixture(), "light"))).toBe(strip(renderChart(fixture(), "dark")));
  });

  test("height is 112 + rows x 34 + 36", () => {
    const svg = renderChart(fixture(), "light");
    expect(svg).toContain('height="284"');
  });

  test("judgement bar widths are proportional to agreement on a 0-100 scale", () => {
    const svg = renderChart(fixture(), "light");
    const ratio = widthOf(svg, "Language Model A: 82%") / widthOf(svg, "Jev: 100%");
    expect(Math.abs(ratio - 0.82)).toBeLessThan(0.01);
  });

  test("missing judgement data renders a dash and no judgement bars", () => {
    const summary = fixture({ models: fixture().models.map((m) => ({ ...m, agreement: null })) });
    const svg = renderChart(summary, "light");
    expect(svg).toContain("—");
    expect(svg.match(/—/g)?.length).toBeGreaterThanOrEqual(summary.models.length);
    expect(bars(svg).some(([, t]) => /: \d+%$/.test(t))).toBe(false);
  });

  test("a long label is truncated to 19 characters and an ellipsis, with the full name in the title", () => {
    const long = `${"x".repeat(20)}${"y".repeat(20)}`;
    const summary = fixture({ models: [model({ id: "long", label: long, kind: "llm", agreement: 50 })] });
    const svg = renderChart(summary, "light");
    expect(svg).toContain(`${"x".repeat(19)}…`);
    expect(svg).not.toContain(`>${long}</text>`);
    expect(svg).toContain(`<title>${long}: 50%</title>`);
  });

  test("labels are XML-escaped", () => {
    const summary = fixture({ models: [model({ id: "x", label: "<script>x</script>", kind: "llm" })] });
    const svg = renderChart(summary, "light");
    expect(svg).not.toContain("<script>x");
    expect(svg).toContain("&lt;script&gt;x");
  });

  test("the footer says 2 seeds for two seeds", () => {
    expect(renderChart(fixture({ seeds: 2 }), "light")).toContain("· 2 seeds ·");
  });

  test("the footer says 1 seed for one seed", () => {
    const svg = renderChart(fixture({ seeds: 1 }), "light");
    expect(svg).toContain("· 1 seed ·");
    expect(svg).not.toContain("1 seeds");
  });

  test("the footer states environment, frozen pieces, real time, cost, date and the CI caveat", () => {
    const svg = renderChart(fixture(), "light");
    expect(svg).toContain(
      "tetris v3 · 2 seeds · frozen: 30 pieces each · real time: 2 minutes · total cost $2.42 · 2026-10-28 · no confidence intervals yet",
    );
  });

  test("the footer leaves out a clause whose value is null", () => {
    const svg = renderChart(fixture({ frozenPieces: null, realtimeSeconds: null }), "light");
    expect(svg).not.toContain("frozen:");
    expect(svg).not.toContain("real time:");
    expect(svg).toContain("total cost $2.42");
  });

  test("the legend shows only the kinds present", () => {
    const summary = fixture({ models: [model({ id: "a", label: "Model A", kind: "llm" })] });
    const svg = renderChart(summary, "light");
    expect(svg).toContain("Language model");
    expect(svg).not.toContain("Decision model");
    expect(svg).not.toContain("Reference (heuristic)");
  });

  test("the real-time value is shown with late share when at least 1% is late", () => {
    const svg = renderChart(fixture(), "light");
    expect(svg).toContain("21.5 · 40% late");
    expect(svg).toContain("88");
  });

  test("a bar's tooltip names the model and its value", () => {
    const svg = renderChart(fixture(), "light");
    expect(svg).toContain("<title>Jev: 310 ms</title>");
    expect(svg).toContain("<title>Model B: 1.2 s</title>");
  });

  test("is deterministic for the same input", () => {
    expect(renderChart(fixture(), "dark")).toBe(renderChart(fixture(), "dark"));
  });

  test("every value label fits inside the 880 px width, even after the longest bar", () => {
    // The longest real-time bar carries a late clause, the widest value label.
    const summary = fixture({
      models: [
        model({ id: "jev", label: "Jev", kind: "system-one", realtimeLanded: 21.5, tooLate: 40 }),
        model({ id: "b", label: "Model B", kind: "llm", realtimeLanded: 9, tooLate: 70 }),
      ],
    });
    for (const svg of [renderChart(summary, "light"), renderChart(fixture(), "light")]) {
      for (const [x, content] of valueLabels(svg)) {
        expect(x + Array.from(content).length * 6.6).toBeLessThanOrEqual(880);
      }
    }
  });

  test("a mock model's label and tooltip say (mock), and a baseline's do not", () => {
    const summary = fixture({
      models: [model({ id: "m", label: "Fast LLM", kind: "llm", mock: true }), model({ id: "h", label: "Heuristic", kind: "baseline", mock: true })],
    });
    const svg = renderChart(summary, "light");
    expect(svg).toContain(">Fast LLM (mock)</text>");
    expect(svg).toContain("<title>Fast LLM (mock): 50%</title>");
    expect(svg).toContain(">Heuristic</text>");
    expect(svg).not.toContain("Heuristic (mock)");
  });

  test("a long mock label is cut before the (mock) tag, so the tag stays visible", () => {
    const summary = fixture({ models: [model({ id: "m", label: "x".repeat(40), kind: "llm", mock: true })] });
    expect(renderChart(summary, "light")).toContain(`>${"x".repeat(12)}… (mock)</text>`);
  });

  test("a real-time limit in whole minutes reads as minutes, and any other as seconds", () => {
    const minutes = renderChart(fixture({ realtimeSeconds: 120 }), "light");
    expect(minutes).toContain("Pieces landed per 2-minute game");
    expect(minutes).toContain("real time: 2 minutes");
    const seconds = renderChart(fixture({ realtimeSeconds: 100 }), "light");
    expect(seconds).toContain("Pieces landed per 100-second game");
    expect(seconds).toContain("real time: 100 seconds");
    expect(seconds).not.toContain("1.66");
  });

  test("the footer names the unfinished matches left out, and says nothing when there are none", () => {
    expect(renderChart(fixture({ skipped: ["a.jsonl", "b.jsonl"] }), "light")).toContain("· 2 unfinished matches left out ·");
    expect(renderChart(fixture({ skipped: ["a.jsonl"] }), "light")).toContain("· 1 unfinished match left out ·");
    expect(renderChart(fixture(), "light")).not.toContain("left out");
  });

  test("short labels keep the original 70 px value room in the judgement panel", () => {
    // Panel width 216.67 - 70 = 146.67 for a full bar.
    const svg = renderChart(fixture(), "light");
    expect(widthOf(svg, "Jev: 100%")).toBe(146.7);
  });
});

/** Value labels (font-size 12) as [x, text], in document order. */
function valueLabels(svg: string): [number, string][] {
  return [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-size="12"[^>]*>([^<]*)<\/text>/g)].map((m) => [Number(m[1]), m[2] ?? ""]);
}
