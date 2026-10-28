// The contract between an environment, the agents that play it, and the runner.
// Nothing here knows about Tetris.

export interface TextPart {
  type: "text";
  text: string;
}
/** What a model is shown. Text only for now; screenshots arrive with the browser environment. */
export type Part = TextPart;

export interface ChoiceOption {
  id: string;
  text: string;
}
export interface ChoiceAction {
  kind: "choice";
  options: ChoiceOption[];
}
/** How a model may answer. Free-form tool calls arrive with the browser environment. */
export type TurnAction = ChoiceAction;

/** One question to a model. `detail` is the environment's own view, for agents that understand it (mocks, baselines); API adapters never read it. */
export interface Turn<D = unknown> {
  id: string;
  instructions: string;
  observation: Part[];
  action: TurnAction;
  deadlineMs: number;
  /** Simulated time the turn was asked. */
  requestedAt: number;
  detail: D;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Answer {
  status: "ok" | "invalid" | "error";
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  usage?: Usage;
  detail?: string;
}

/**
 * Hands an answer back to the match. `arrivesAt` is in simulated time; pass the
 * measured wall-clock latency for live calls, or leave it out to use arrivesAt - requestedAt.
 */
export type DeliverAnswer = (answer: Answer, arrivesAt: number, latencyMs?: number) => void;

export interface AgentContext {
  /** Current simulated time of the match. */
  now(): number;
  /** Aborted when the match stops, so in-flight HTTP calls can be cancelled. */
  signal: AbortSignal;
}

/** Something that answers turns: a model behind an adapter, a mock, or a baseline. */
export interface Agent<D = unknown> {
  /** Called once per turn. Call `deliver` once with the answer, or never to simulate a hang. */
  request(turn: Turn<D>, deliver: DeliverAnswer, ctx: AgentContext): void;
}

/** Several agents playing one environment on one simulated clock. */
export interface Match<E> {
  readonly t: number;
  readonly finished: boolean;
  start(): E[];
  /** Advances the match by `dtMs` of simulated time and returns what happened. */
  step(dtMs: number): E[];
  stop(): E[];
}

export interface Environment<C, E, D = unknown> {
  id: string;
  /** Bumped when rules or prompts change; results from different versions aren't compared. */
  version: string;
  variants: readonly string[];
  createMatch(config: C, agents: Agent<D>[]): Match<E>;
}

/**
 * Events every environment's log carries. The runner, results and stats read only these,
 * so they work for any environment; an environment adds its own events alongside.
 */
export type CoreEvent =
  | { t: "run_started"; at: number; config: { agents: { id: string; name: string }[] } }
  | { t: "decision"; at: number; agentId: string; status: string; latencyMs: number; usage?: Usage }
  | { t: "episode_finished"; at: number; agentId: string; outcome: string }
  | { t: "run_finished"; at: number; reason: "all_out" | "time_limit" | "stopped" };

const CORE_EVENTS: ReadonlySet<string> = new Set(["run_started", "decision", "episode_finished", "run_finished"]);

export function isCoreEvent(e: { t: string }): e is CoreEvent {
  return CORE_EVENTS.has(e.t);
}
