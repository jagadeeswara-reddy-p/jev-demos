import type { AgentKind } from "../arena/types";

// Mock decision sources. Each one imitates how a kind of model behaves from the
// arena's point of view: how long it takes, how well it chooses, and how it fails.
// Placement quality comes from the Dellacherie heuristic run through a softmax:
// temperature 0 always picks the best spot, Infinity picks at random.

export interface MockProfile {
  id: string;
  label: string;
  kind: AgentKind;
  description: string;
  latency: { medianMs: number; spread: number };
  temperature: number;
  invalidRate: number;
  errorRate: number;
  /** Chance a request never comes back. */
  hangRate: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

export const MOCK_PROFILES: MockProfile[] = [
  {
    id: "jev",
    label: "Jev",
    kind: "system-one",
    description: "System One model, mocked at about 0.28 s per decision",
    latency: { medianMs: 280, spread: 0.18 },
    temperature: 1.2,
    invalidRate: 0,
    errorRate: 0.002,
    hangRate: 0,
    usage: { inputTokens: 900, outputTokens: 0, costUsd: 0.0000378 },
  },
  {
    id: "llm-fast",
    label: "Fast LLM",
    kind: "llm",
    description: "Small chat model, mocked at about 0.75 s per decision",
    latency: { medianMs: 740, spread: 0.25 },
    temperature: 1.2,
    invalidRate: 0.01,
    errorRate: 0.004,
    hangRate: 0,
    usage: { inputTokens: 1100, outputTokens: 12, costUsd: 0.00116 },
  },
  {
    id: "llm-frontier",
    label: "Frontier LLM",
    kind: "llm",
    description: "Large reasoning model, mocked at about 6 s per decision",
    latency: { medianMs: 5990, spread: 0.3 },
    temperature: 0.35,
    invalidRate: 0.005,
    errorRate: 0.004,
    hangRate: 0,
    usage: { inputTokens: 1100, outputTokens: 900, costUsd: 0.028 },
  },
  {
    id: "llm-flaky",
    label: "Flaky LLM",
    kind: "llm",
    description: "Chat model with bad answers, errors and hung requests",
    latency: { medianMs: 1200, spread: 0.45 },
    temperature: 1.6,
    invalidRate: 0.08,
    errorRate: 0.05,
    hangRate: 0.03,
    usage: { inputTokens: 1100, outputTokens: 20, costUsd: 0.0016 },
  },
  {
    id: "heuristic",
    label: "Heuristic bot",
    kind: "baseline",
    description: "Hand-written evaluator, always picks its best spot",
    latency: { medianMs: 3, spread: 0.1 },
    temperature: 0,
    invalidRate: 0,
    errorRate: 0,
    hangRate: 0,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  },
  {
    id: "random",
    label: "Random",
    kind: "baseline",
    description: "Picks any legal spot at random",
    latency: { medianMs: 1, spread: 0 },
    temperature: Infinity,
    invalidRate: 0,
    errorRate: 0,
    hangRate: 0,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  },
  {
    id: "no-input",
    label: "No input",
    kind: "baseline",
    description: "Never answers, so every piece falls straight down",
    latency: { medianMs: 0, spread: 0 },
    temperature: 0,
    invalidRate: 0,
    errorRate: 0,
    hangRate: 1,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  },
  // Stand-ins for the six-model line-up, so the layout and results screen can be
  // previewed before every API is wired up. Speeds and skill are rough guesses
  // from the live runs (GPT and Opus) or placeholders until those APIs are wired up.
  {
    id: "preview-gpt",
    label: "GPT-6.1 Sol",
    kind: "llm",
    description: "Preview: mocked like gpt-6.1-sol, about 4 s per decision, strong moves",
    latency: { medianMs: 4000, spread: 0.3 },
    temperature: 0.3,
    invalidRate: 0.003,
    errorRate: 0.002,
    hangRate: 0,
    usage: { inputTokens: 2300, outputTokens: 60, costUsd: 0.0058 },
  },
  {
    id: "preview-opus",
    label: "Claude Opus 5.5",
    kind: "llm",
    description: "Preview: mocked like claude-opus-5-5, about 3 s per decision, strong moves",
    latency: { medianMs: 3100, spread: 0.35 },
    temperature: 0.35,
    invalidRate: 0.01,
    errorRate: 0.002,
    hangRate: 0,
    usage: { inputTokens: 2400, outputTokens: 80, costUsd: 0.0123 },
  },
  {
    id: "preview-laya",
    label: "Laya",
    kind: "system-one",
    description: "Preview: mocked open-source System One model, self-hosted, about 0.4 s",
    latency: { medianMs: 420, spread: 0.2 },
    temperature: 1.7,
    invalidRate: 0,
    errorRate: 0.002,
    hangRate: 0,
    usage: { inputTokens: 1400, outputTokens: 0, costUsd: 0 },
  },
  {
    id: "preview-cloudflare",
    label: "Cloudflare Clef",
    kind: "llm",
    description: "Preview: mocked @cf/cloudflare/clef on Workers AI, about 0.6 s per decision",
    latency: { medianMs: 600, spread: 0.3 },
    temperature: 1.3,
    invalidRate: 0.01,
    errorRate: 0.004,
    hangRate: 0,
    usage: { inputTokens: 2300, outputTokens: 20, costUsd: 0.0004 },
  },
  {
    id: "preview-strands",
    label: "Strands Decider",
    kind: "system-one",
    description: "Preview: mocked AWS Strands Decider 2B, about 0.2 s per decision",
    latency: { medianMs: 200, spread: 0.25 },
    temperature: 1.5,
    invalidRate: 0,
    errorRate: 0.002,
    hangRate: 0,
    usage: { inputTokens: 1400, outputTokens: 0, costUsd: 0 },
  },
];

export function getProfile(id: string): MockProfile {
  const p = MOCK_PROFILES.find((m) => m.id === id);
  if (!p) throw new Error(`Unknown mock profile "${id}"`);
  return p;
}
