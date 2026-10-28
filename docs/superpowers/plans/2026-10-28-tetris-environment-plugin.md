# Tetris as an Environment Plugin: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the engine-agnostic contract (`Turn`, `Answer`, `Agent`, `Match`, `Environment`) from Tetris, so the model adapters no longer know about Tetris, **without changing any run's output**.

**Architecture:**
- A new `src/core/types.ts` holds the generic contract.
- Tetris builds a `Turn` per piece (instructions, observation text, a choice of options, and its own `detail` for game-aware agents).
- The three adapters build their requests only from the `Turn`.
- `ArenaSimulation` already has the shape of a `Match`; a `tetris` environment object exposes it.
- Golden snapshots, taken before any change, prove these are true after the change:
  - mock runs produce byte-identical event logs;
  - every adapter sends byte-identical requests.

**Tech Stack:** Bun 1.4, TypeScript, `bun:test`, Biome.

**Spec:** `docs/design/eval-engine.md`, migration step 1 ("Make the Tetris engine and arena an `Environment` plugin" and "Generic `Turn`/`Answer`; adapters lose `DecisionRequest`").

**Branch:** `engine-core` from `main`. One PR at the end.

## Global Constraints

- No behaviour change. The golden tests from Task 1 must pass unchanged at the end of every later task, and their fixture files must never be edited after Task 1.
- Keys never reach the browser or logs (unchanged; don't touch `redact`).
- Keep the file layout. `src/engine`, `src/arena` and `src/mock` stay where they are; moving Tetris under `src/envs/` waits for the second environment.
- Out of scope for this PR (later steps in the design):
  - the `throttled` status;
  - `providerRequestId`;
  - the `tool` action kind and image observations;
  - `bench.yaml`;
  - the board-only variant;
  - scoring and metrics on the environment.
- Match the code style around you: short header comment per file, sparse comments, Biome formatting (`bun run format`).
- Commits carry no Co-Authored-By lines.
- Checks before every commit: `bun run lint && bun run typecheck && bun test`.

## Review Focus

1. **Byte-identical prompts.** Golden adapter bodies from Task 1 catch any whitespace or ordering drift, for example a changed `\n\n` between state and options, or the system text. They are owned by Task 1 and re-run in Task 3.
2. **Option order.** `turn.action.options` must keep the engine's candidate order, because rotations and position-bias results depend on it. Task 2 tests it.
3. **Mock determinism.** Mock agents must draw from their RNG in exactly the same order as before. Reading from `turn.detail` instead of `req` must not add or skip an `rng()` call. The Task 1 event-log hashes are owned by Task 1 and re-run in Task 3.
4. **The Test button and smoke script** still report the offered option count and flag an answer naming an option that wasn't offered. Task 3 tests `testModel`.
5. **Late answers after stop.** A `Match` that has been stopped must still ignore answers delivered later (`delivered`/`finished` guard in `request`). This is covered by the existing simulation tests, which Task 3 keeps passing.

---

### Task 1: Golden snapshots of today's behaviour

These are taken on unchanged code, so later tasks have something to match.

**Files:**
- Create: `src/arena/golden.test.ts`, `src/arena/__golden__/runs.json`
- Create: `server/adapters/golden.test.ts`, `server/adapters/__golden__/bodies.json`
- Add to the commit: `docs/design/eval-engine.md` (currently untracked) and this plan

**Interfaces:**
- Produces: two fixture files that no later task may edit.

- [ ] **Step 1: Write `src/arena/golden.test.ts`.** For each of `realtime` and `frozen` × seeds `1, 2`:
  - Run a mock match with one board per entry in `MOCK_PROFILES`, using the same `config()` and `runToEnd()` helpers as `simulation.test.ts` (copy them; `maxPieces: 300`).
  - Serialize with `events.map((e) => JSON.stringify(e)).join("\n")`, which is exactly what a JSONL run log contains.
  - Record `{ events: number, sha256: string }` keyed `"<mode>-seed<seed>"`. Hash with `new Bun.CryptoHasher("sha256")`.
  - When `Bun.env.UPDATE_GOLDEN === "1"`, write `__golden__/runs.json`; otherwise `expect(actual).toEqual(fixture)`.
- [ ] **Step 2: Write `server/adapters/golden.test.ts`.** For `sampleRequest(1)` and `sampleRequest(2)`, record these, keyed `"<case>-seed<n>"`:
  - `completionBody(m, req)` with `jsonMode` `"schema"` and `"object"`;
  - `decisionBody(m, req)` with `rotations` 1 and 4;
  - `converseInput(m, req)` with `toolChoice` unset and `"auto"`.

  Use one fixed `ModelConfig` per adapter: model `"fake"`, no `extraBody`. The same `UPDATE_GOLDEN` switch writes `__golden__/bodies.json`.
- [ ] **Step 3: Generate the fixtures.** Run `UPDATE_GOLDEN=1 bun test golden`. Expected: two JSON files written. Open `bodies.json` and check it holds real prompt text and option lists.
- [ ] **Step 4: Check that they pass without the switch.** Run `bun test golden`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: "Golden snapshots of run logs and adapter requests". Also commit the design doc and this plan.

### Task 2: The core contract and Tetris turns

**Files:**
- Create: `src/core/types.ts`, `src/core/turn.ts`, `src/core/turn.test.ts`
- Create: `src/arena/turn.ts`, `src/arena/turn.test.ts`
- Modify: `src/arena/types.ts` (add `TetrisTurnDetail`, `TetrisAgent`)
- Modify: `src/arena/prompt.ts`. The parameter types of `stateText` and `optionDescriptions` become `TetrisTurnDetail`, and `candidateFeatures`'s `type` parameter becomes `PieceType`. The bodies don't change.

**Interfaces:**
- Produces, in `src/core/types.ts` (header comment: "The contract between an environment, the agents that play it, and the runner. Nothing here knows about Tetris."):

```ts
export interface TextPart { type: "text"; text: string }
/** What a model is shown. Text only for now; screenshots arrive with the browser environment. */
export type Part = TextPart;
export interface ChoiceOption { id: string; text: string }
export interface ChoiceAction { kind: "choice"; options: ChoiceOption[] }
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

export interface Usage { inputTokens: number; outputTokens: number; costUsd: number }
export interface Answer {
  status: "ok" | "invalid" | "error";
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  usage?: Usage;
  detail?: string;
}
export type DeliverAnswer = (answer: Answer, arrivesAt: number, latencyMs?: number) => void;
export interface AgentContext { now(): number; signal: AbortSignal }
/** Something that answers turns: a model behind an adapter, a mock, or a baseline. */
export interface Agent<D = unknown> {
  request(turn: Turn<D>, deliver: DeliverAnswer, ctx: AgentContext): void;
}

/** Several agents playing one environment on one simulated clock. */
export interface Match<E> {
  readonly t: number;
  readonly finished: boolean;
  start(): E[];
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
```

- Produces, in `src/core/turn.ts`: `observationText(turn: Turn): string`, which joins the text parts with `"\n\n"`.
- Produces, in `src/arena/types.ts`:
  - `interface TetrisTurnDetail { agentId: string; pieceId: number; type: PieceType; board: string; next: PieceType[]; candidates: CandidateView[]; level: number; mode: ClockMode }`
  - `type TetrisAgent = Agent<TetrisTurnDetail>`
- Produces, in `src/arena/turn.ts`: `tetrisTurn(detail: TetrisTurnDetail, deadlineMs: number, requestedAt: number): Turn<TetrisTurnDetail>`, where:
  - `id` is `` `${detail.agentId}:${detail.pieceId}` ``;
  - `instructions` is `TASK`;
  - `observation` is `[{ type: "text", text: stateText(detail) }]`;
  - `action` is `{ kind: "choice", options }`, built from `optionDescriptions(detail)` in candidate order.

- [ ] **Step 1: Write the failing tests.**
  - `src/core/turn.test.ts`: `observationText` returns `"a\n\nb"` for two parts `a` and `b`, and `"a"` for one.
  - `src/arena/turn.test.ts`, using a detail built like today's `sampleRequest(1)` (spawn the first piece of `new TetrisGame(1)`):
    - `turn.action.options.map((o) => o.id)` equals `detail.candidates.map((c) => c.id)`;
    - each option's `text` equals `optionDescriptions(detail)[id]`;
    - `observationText(turn)` equals `stateText(detail)`;
    - `turn.instructions` equals `TASK`;
    - `turn.id` is `"test:1"` for `agentId: "test"` and the first piece.
- [ ] **Step 2: Check that they fail.** Run `bun test turn`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement** `src/core/types.ts`, `src/core/turn.ts`, the two additions to `src/arena/types.ts`, the `prompt.ts` parameter types and `src/arena/turn.ts`. Old types stay for now. `DecisionRequest` is structurally a superset of `TetrisTurnDetail`, so existing callers of `prompt.ts` still compile.
- [ ] **Step 4: Run the checks.** Run `bun test && bun run typecheck`. Expected: PASS, including golden.
- [ ] **Step 5: Commit.** Message: "Core Turn/Answer/Agent contract and Tetris turns".

### Task 3: Run every decision through `Agent` and `Turn`

The adapters, the simulation and the mocks switch together, because `server/sources.ts` hands both kinds of agent to one simulation.

**Files:**
- Modify: `server/adapters/types.ts`. It becomes `decide(model: ModelConfig, turn: Turn, signal: AbortSignal): Promise<Answer>`.
- Modify: `server/adapters/shared.ts`:
  - `liveSource(call: (turn: Turn, signal: AbortSignal) => Promise<Answer>, timeoutMs): Agent`;
  - `systemText(turn): string` replaces the `SYSTEM` const. It returns `` `${turn.instructions} Reply with JSON only, in the form {"choice": "<option id>"}.` ``;
  - `userText(turn)`. Its output is the same as today's: observation text, `"\n\nOptions:\n"`, then one `id: text` line per option;
  - `choiceSchema(turn)`. The enum is `turn.action.options` ids;
  - `httpError` and `parseChoice` return `Answer`; `usageOf` returns `Usage`.
- Modify: `server/adapters/completion.ts`, `decision.ts`, `bedrock.ts`. They build only from `turn`:
  - `decisionBody`: `criteria` comes from the options, `instructions` from `turn.instructions`, `state` from `observationText(turn)`;
  - rotations count `turn.action.options.length`.
- Modify: `server/adapters/index.ts`. `sourceFor(model): Agent`.
- Modify: `server/sample.ts`:
  - `sampleTurn(seed = 1): Turn<TetrisTurnDetail>` replaces `sampleRequest`;
  - `testModel(model, turn = sampleTurn())`, where `options` is `turn.action.options.length` and the offered set is the option ids;
  - `TestResult extends Answer`.
- Modify: `scripts/smoke.ts`, `scripts/position-bias.ts`, `server/routes/models.ts` (imports only).
- Modify: `src/arena/simulation.ts`:
  - `constructor(config, agents: TetrisAgent[])`;
  - `request()` builds the turn with `tetrisTurn(detail, deadlineMs, requestedAt)`;
  - `PendingDecision` uses `Usage`.
- Modify: `src/mock/mockSource.ts`. `createMockSource` and `mockSourceFor` return `TetrisAgent`, reading `turn.detail.board`, `turn.detail.type`, `turn.detail.candidates` and `turn.requestedAt`. Keep the `rng()` call order exactly as it is.
- Modify: `server/sources.ts`. `createSource(...): TetrisAgent`.
- Modify: `src/arena/types.ts`:
  - delete `DecisionRequest`, `DecisionAnswer`, `DeliverAnswer`, `DecisionContext`, `DecisionSource`, `DecisionUsage`;
  - the `decision` event's `usage` becomes `Usage` from core.
- Modify tests:
  - `server/adapters/*.test.ts` and `golden.test.ts` call `sampleTurn(n)` where they called `sampleRequest(n)`;
  - `src/arena/simulation.test.ts` uses `TetrisAgent`, and its hand-written agents read `turn.requestedAt`;
  - `golden.test.ts` changes only at the call site. Its fixtures stay untouched.

**Interfaces:**
- Consumes: Task 2's `Turn`, `Answer`, `Usage`, `Agent`, `TetrisAgent`, `TetrisTurnDetail`, `tetrisTurn` and `observationText`.
- Produces:
  - `sourceFor(model: ModelConfig): Agent`
  - `sampleTurn(seed?: number): Turn<TetrisTurnDetail>`
  - `testModel(model: ModelConfig, turn?: Turn<TetrisTurnDetail>): Promise<TestResult>`
  - `ArenaSimulation(config: RunConfig, agents: TetrisAgent[])`

- [ ] **Step 1: Write the new failing tests.**
  - `server/adapters/shared.test.ts`: `systemText(sampleTurn())` equals `` `${TASK} Reply with JSON only, in the form {"choice": "<option id>"}.` ``.
  - `server/adapters/shared.test.ts`: `choiceSchema(sampleTurn()).properties.choice.enum` equals the turn's option ids.
  - New `server/sample.test.ts`: `testModel` with a stub adapter that answers `option_999` gives status `"invalid"` and `options === sampleTurn().action.options.length`. Stub the call by giving `testModel` a model whose `baseUrl` is a `Bun.serve` that returns `{"choices":[{"message":{"content":"{\"choice\":\"option_999\"}"}}]}`, the same way `completion.test.ts` sets up its server.
- [ ] **Step 2: Check that they fail.** Run `bun test server`. Expected: FAIL, `systemText` and `sampleTurn` not exported.
- [ ] **Step 3: Implement** every file listed above. Search for leftovers: `grep -rn "DecisionRequest\|DecisionAnswer\|DecisionSource\|DecisionUsage\|sampleRequest\|SYSTEM\b" src server scripts` must print nothing.
- [ ] **Step 4: Run everything.** Run `bun run lint && bun run typecheck && bun test`. Expected: PASS. **Golden runs and golden bodies pass with untouched fixtures.** If a golden test fails, fix the code, not the fixture.
- [ ] **Step 5: Run end to end against the fake providers.**
  - In one terminal: `bun scripts/fake-providers.ts`.
  - In another: `LLM_BASE_URL=http://localhost:5400/v1 LLM_API_KEY=fake LLM_MODEL=fake bun scripts/smoke.ts live-llm`.

  Expected: one `ok` answer naming an `option_N`, with a latency of about 750 ms.
- [ ] **Step 6: Commit.** Message: "Adapters, simulation and mocks speak Turn/Answer".

### Task 4: The `tetris` environment

**Files:**
- Create: `src/arena/environment.ts`, `src/arena/environment.test.ts`
- Modify: `server/runs.ts`, `src/mock/mockBackend.ts`. They call `tetris.createMatch(config, agents)` instead of `new ArenaSimulation(...)`. Type the field as `Match<ArenaEvent>`. Both only use `start`, `step`, `stop`, `t` and `finished`.
- Modify: `src/arena/simulation.ts`. It becomes `class ArenaSimulation implements Match<ArenaEvent>`.

**Interfaces:**
- Consumes: Task 2's `Environment` and `Match`; Task 3's `ArenaSimulation(config, agents)`.
- Produces: `export const tetris: Environment<RunConfig, ArenaEvent, TetrisTurnDetail>`, with `id: "tetris"`, `version: "1"` and `variants: ["described"]`.

- [ ] **Step 1: Write the failing test.** In `environment.test.ts`:
  - `tetris.id === "tetris"`;
  - `tetris.variants` equals `["described"]`;
  - a match from `tetris.createMatch(cfg, mocks)`, run to the end, gives the same SHA-256 as `__golden__/runs.json["realtime-seed1"]`. Read the fixture file and reuse the config helper from the golden test, exported from a small shared `src/arena/testRuns.ts` if both need it.
- [ ] **Step 2: Check that it fails.** Run `bun test environment`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `environment.ts`, `implements Match<ArenaEvent>`, and the two call sites.
- [ ] **Step 4: Run the checks.** Run `bun run lint && bun run typecheck && bun test`. Expected: PASS.
- [ ] **Step 5: Run the server.** Run `bun dev` and `curl -s localhost:5317/api/sources | head -c 300`; the exact route is in `server/index.ts`. Expected: the model list returns. Leave the in-page check to the user.
- [ ] **Step 6: Commit.** Message: "Tetris exposed as an Environment".

### Task 5: Docs

**Files:**
- Modify: `docs/models.md` ("Writing an adapter", around line 205). Show the new `Adapter` interface and explain the `Turn` fields an adapter uses: `instructions`, `observation` via `observationText`, `action.options` and `deadlineMs`. Say that `detail` is off-limits to adapters.
- Modify: `docs/development.md`. Add `src/core/` to the layout list, with one line on `types.ts` and `turn.ts`, plus `src/arena/environment.ts` and `turn.ts`.
- Modify: `docs/design/eval-engine.md`:
  - The "Environment plugin" sketch becomes the match-level `Environment`/`Match` that shipped, with a note that `score` and `metrics` come with the results bundle (step 5).
  - The "Turns" sketch gains `detail`.
  - Mark migration step 1 as done.

- [ ] **Step 1: Make the edits.** Copy the type blocks from `src/core/types.ts`; don't paraphrase them.
- [ ] **Step 2: Check for stale names.** Run `grep -rn "DecisionRequest\|DecisionAnswer\|DecisionSource" docs`. Expected: no matches outside `docs/findings.md` and `docs/results-history.md`, which are history.
- [ ] **Step 3: Commit.** Message: "Docs for the core contract".
- [ ] **Step 4: Push and open the PR.** Push `engine-core` and open a PR to `main` titled "Engine core: Tetris as an Environment, adapters on Turn/Answer". The body says:
  - this is a no-behaviour-change refactor;
  - golden logs and request bodies are byte-identical;
  - what is deferred to later steps.

  Following the owner's standing rule, add no Claude attribution to commits or the PR.
