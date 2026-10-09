import type { ClockMode } from "../arena/types";

// Preset line-ups. Each one is a starting point; boards can still be added,
// removed or switched to another source before a run.
export interface Scenario {
  id: string;
  label: string;
  note: string;
  mode: ClockMode;
  sources: string[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: "live",
    label: "Live: Jev vs LLM",
    note: "The real thing: Jev and your language model through their APIs, on the same pieces.",
    mode: "realtime",
    sources: ["live-jev", "live-llm"],
  },
  {
    id: "live-frozen",
    label: "Live, frozen clock",
    note: "Jev and your language model with the clock frozen, to compare placement skill without speed.",
    mode: "frozen",
    sources: ["live-jev", "live-llm"],
  },
  {
    id: "jev-vs-llm",
    label: "Mock: Jev vs fast LLM",
    note: "Mocked models, so it runs at any speed: one System One model against one chat model.",
    mode: "realtime",
    sources: ["jev", "llm-fast"],
  },
  {
    id: "jev-vs-frontier",
    label: "Mock: Jev vs frontier LLM",
    note: "A smarter but much slower model. In real time it runs out of clock long before it runs out of ideas.",
    mode: "realtime",
    sources: ["jev", "llm-frontier"],
  },
  {
    id: "frozen",
    label: "Mock: frozen clock",
    note: "The game waits for every answer, so this measures placement skill with speed taken out.",
    mode: "frozen",
    sources: ["jev", "llm-frontier"],
  },
  {
    id: "linkedin",
    label: "Mock: the LinkedIn demo",
    note: "Three boards at roughly 0.28 s, 0.74 s and 6 s per decision, like the video that started this.",
    mode: "realtime",
    sources: ["jev", "llm-fast", "llm-frontier"],
  },
  {
    id: "failures",
    label: "Mock: failure modes",
    note: "A model that sometimes answers off-list, errors out or hangs, to check the arena counts each case.",
    mode: "realtime",
    sources: ["jev", "llm-flaky"],
  },
  {
    id: "baselines",
    label: "Mock: baselines",
    note: "A hand-written bot as the ceiling, random and no-input as the floor, with Jev in between.",
    mode: "realtime",
    sources: ["heuristic", "jev", "random", "no-input"],
  },
];
