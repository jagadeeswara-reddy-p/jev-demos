# bench.yaml, Headless Runner, and init/doctor/demo: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can describe up to 12 models in `bench.yaml` and run every seed, clock and variant from the command line:
- `bun bench run` runs it, after a preflight (one real answer per model, then a time and cost estimate) and a confirmation;
- an interrupted run resumes where it stopped;
- `bun bench init`, `bun bench doctor` and `bun bench demo` make the first run easy.

**Architecture:**
- **Where it lives:** a new `server/bench/` folder.
  - `config.ts` parses and validates the file.
  - `entrants.ts` resolves each model entry to something that can play.
  - `plan.ts` lists the matches.
  - `runner.ts` plays them one at a time, writing one JSONL log per match in today's run-log format, so the page's replay and `bun run stats` work unchanged.
  - `preflight.ts` checks the models and estimates time and cost.
  - `cli.ts` holds the four commands.
- **How a match is played:** through `tetris.createMatch` from step 1.
  - Mock-only line-ups run as fast as the CPU allows.
  - Line-ups with any live model follow the wall clock 1:1, like today's server.

**Tech Stack:** Bun 1.4 (`Bun.YAML.parse`, `Bun.spawn`), TypeScript, `bun:test`, Biome.

**Spec:** `docs/design/eval-engine.md`, sections "Config: `bench.yaml`", "Runner", "Unfinished episodes", "Getting started fast", and migration step 3.

**Branch:** `bench-runner`, cut from `engine-core` (PR #5). Open the PR against `engine-core`, and retarget it to `main` once #5 merges.

## Global Constraints

- **Keys:** `apiKey` in `bench.yaml` must be an `${ENV}` placeholder. A literal key is refused at load time. The run manifest stores the config as written (placeholders, never filled values).
- **Models:** at most 12 per bench (`BENCH_MAX_MODELS = 12`). This is independent of the page's `MAX_BOARDS`, which stays 6 until step 6.
- **Defaults,** copied from the spec:
  - `seeds` defaults to 5, meaning seeds 1–5; a number `n` means seeds 1–n; a list is used as given;
  - `clocks` defaults to `[frozen, realtime]`;
  - `variants` defaults to `[described]`;
  - `limits.stopWhenFinished` defaults to `0.75`;
  - `tetris.goal` is `survive`, or `sprint40` (40 lines);
  - `tetris.maxDurationMs` defaults to 600000; `tetris.maxPieces` to 1000.
- **Stop rule:** a match stops once `ceil(n × stopWhenFinished)` of its `n` boards are done (topped out, survived or reached the goal). The boards still playing are **unfinished**.
- **Order and logs:**
  - Matches run one at a time: variants, then clocks (frozen before realtime), then seeds.
  - Logs go to `<outDir>/<variant>-<clock>-seed<seed>.jsonl`; the manifest is `<outDir>/bench.json`.
  - The default `outDir` is `runs/bench/<name>`.
- **Out of scope** (later steps or not needed yet):
  - `repeats`;
  - `concurrency` and parallel frozen matches;
  - the board-only variant (step 4);
  - the results bundle, signing and a results page (steps 5 and 7);
  - a 12-board page layout (step 6);
  - publishing to npm.
- **Style:** match the surrounding code: a short header comment per file, few comments, Biome formatting (`bun run format`). No Claude attribution in commits or the PR.
- **Checks before every commit:** `bun run lint && bun run typecheck && bun test`.

## Review Focus

1. **A literal API key in `bench.yaml`** is refused with the field named, and never reaches `bench.json`. Task 1 tests the refusal; Task 3 tests the manifest.
2. **A run killed mid-match** leaves a log without `run_finished`. Resuming rewrites that match from the start and leaves finished matches untouched. Task 3 tests this.
3. **A model whose `${ENV}` variable is unset:**
   - `doctor` and `run` name the variable;
   - `run` refuses to start;
   - other models still get checked.

   Tasks 2 and 4 test this.
4. **Pace:** a mock-only line-up never waits on the wall clock; one live model switches the whole bench to wall-clock pace. Task 5 tests `paceFor`.
5. **Stop-rule edges:**
   - 1 model stops only when it's done;
   - 4 models at 0.75 stop at 3;
   - 12 at 0.75 stop at 9;
   - the remaining boards are listed as unfinished.

   Task 3 tests this.

---

### Task 1: `bench.yaml` parsing and validation

**Files:**
- Create: `server/bench/config.ts`, `server/bench/config.test.ts`
- Create: `bench.example.yaml`. It is the documented template `init` copies, and is also used as a test fixture.
- Modify: `.gitignore`. Add `bench.yaml`, since personal benches stay local.

**Interfaces:**
- Produces:

```ts
export const BENCH_MAX_MODELS = 12;
/** A model id (built-in, page-added or mock) or an inline model, as written: placeholders kept. */
export type BenchModelEntry = string | Record<string, unknown>;
export interface BenchConfig {
  name: string;
  environment: "tetris";
  seeds: number[];
  clocks: ClockMode[];            // normalised order: frozen, realtime
  variants: string[];
  goal: "survive" | "sprint40";
  maxDurationMs: number;
  maxPieces: number;
  stopWhenFinished: number;
  maxCostUsd?: number;
  models: BenchModelEntry[];
}
export class BenchConfigError extends Error { constructor(readonly field: string, message: string) } // message: `${field}: ${message}`
export function parseBench(raw: unknown): BenchConfig;
/** .yaml/.yml through Bun.YAML.parse, .json through JSON.parse; errors name the file. */
export async function loadBench(path: string): Promise<BenchConfig>;
```

The `bench.example.yaml` layout:
- Top level: `name`, `environment`, `seeds`, `clocks`, `variants`, and the `tetris:`, `limits:` and `models:` blocks.
- Each block gets a one-line comment.
- `models` has three entries:
  - `- live-jev`
  - `- heuristic  # a mock baseline: no API calls`
  - an inline completion model with `apiKey: ${OPENROUTER_API_KEY}` and `prices`.

Validation rules:
- Unknown keys are errors at the top level and inside `tetris` and `limits`.
- `name` must match `ID_PATTERN` from `server/models/validate.ts`.
- `environment`, if present, must be `"tetris"`.
- `seeds`:
  - a number must be an integer from 1 to 100;
  - a list must be 1–100 distinct integers ≥ 0.
- `clocks` must be a non-empty set drawn from `frozen` and `realtime`.
- Each entry in `variants` must be in `tetris.variants`.
- `maxDurationMs` must be an integer from 10000 to 3600000.
- `maxPieces` must be an integer from 1 to 10000.
- `stopWhenFinished` must be in (0, 1].
- `maxCostUsd` must be greater than 0.
- `models` must hold 1–12 entries:
  - a string must match `ID_PATTERN`;
  - an object needs a string `id` matching `ID_PATTERN`;
  - ids must be unique.
- An object's `apiKey`, if present, must match `/^\$\{[A-Z0-9_]+(:-[^}]*)?\}$/`. Otherwise it's a `BenchConfigError("models[<i>].apiKey", "must be an ${ENV} placeholder; put the key itself in .env")`.
- Inline models are not validated further here. `entrants.ts` does that after filling in the environment, because addresses may be placeholders.

- [ ] **Step 1: Write the failing tests** in `config.test.ts`:
  - `parseBench({ name: "a", models: ["jev"] })` gives:
    - `seeds` `[1,2,3,4,5]`;
    - `clocks` `["frozen","realtime"]`;
    - `variants` `["described"]`;
    - `goal` `"survive"`, `maxDurationMs` `600000`, `maxPieces` `1000`;
    - `stopWhenFinished` `0.75`.
  - `seeds: 3` gives `[1,2,3]`; `seeds: [7, 9]` gives `[7,9]`; `seeds: 0` throws with field `seeds`.
  - `clocks: ["realtime","frozen"]` gives `["frozen","realtime"]`; `clocks: []` throws `clocks`.
  - `variants: ["board-only"]` throws `variants`. That variant is not yet in `tetris.variants`.
  - An inline model with `apiKey: "sk-live-123"` throws with field `models[0].apiKey`. With `apiKey: "${OPENROUTER_API_KEY}"` it parses, and the entry is kept as written.
  - Two entries with id `jev` throw `models[1]`. Thirteen models throw `models`.
  - Unknown top-level key `concurrency` throws `concurrency`. `tetris: { speed: 2 }` throws `tetris.speed`.
  - `await loadBench("bench.example.yaml")` parses and has 3 models.
  - `loadBench` of a temp `.json` file with the same content as the example parses to the same `BenchConfig`.
- [ ] **Step 2: Check that they fail.** Run `bun test server/bench/config`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `config.ts` and `bench.example.yaml`, and add `bench.yaml` to `.gitignore`.
- [ ] **Step 4: Check that they pass.** Run `bun test server/bench/config`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: "bench.yaml loader and validation".

### Task 2: Entrants, the models of a bench resolved

**Files:**
- Create: `server/bench/entrants.ts`, `server/bench/entrants.test.ts`

**Interfaces:**
- Consumes: Task 1's `BenchModelEntry`, `BenchConfigError`. Also:
  - `fillEnv` and `Env` (`server/models/env.ts`);
  - `validateModel`, `ModelError` (`server/models/validate.ts`);
  - `ADAPTERS`, `sourceFor` (`server/adapters/index.ts`);
  - `SourceInfo`, `AgentSpec`, `AgentKind`, `RunConfig`, `TetrisAgent` (`src/arena/types.ts`).
- Produces:

```ts
export interface BenchEntrant {
  id: string;
  label: string;
  kind: AgentKind;
  /** Calls a real API. Any live entrant makes the bench run on the wall clock. */
  live: boolean;
  /** Inline models from bench.yaml, placeholders filled. Id-only entries resolve through `sources` instead. */
  model?: ModelConfig;
  /** Why it can't run, e.g. "set OPENROUTER_API_KEY in .env". */
  unavailable?: string;
}
export function resolveEntrants(entries: BenchModelEntry[], sources: SourceInfo[], env: Env): BenchEntrant[];
/** The agent for one board. `spec` must be the object in `run.agents`, since mock seeding depends on its position. */
export function agentFor(entrant: BenchEntrant, run: RunConfig, spec: AgentSpec, fallback: (run: RunConfig, spec: AgentSpec) => TetrisAgent): TetrisAgent;
```

Rules for each kind of entry:
- **A string id:**
  - The source with that id supplies `label`, `kind` and `live`.
  - If the source isn't `available`, its `reason` becomes `unavailable`.
  - An unknown id throws `BenchConfigError("models[<i>]", 'unknown model "<id>"; known: <comma-separated ids>')`.
- **An object:**
  - Run `fillEnv(entry, env)`. If any variables are missing, `unavailable` becomes `` `set ${missing.join(", ")} in .env` ``. Keep `id`, use `label` (or the id), set `live: true`, and take `kind` from `ADAPTERS[adapter]` when `adapter` is valid, otherwise `"llm"`.
  - Otherwise run `validateModel(filled, { allowBedrock: true })`. Rethrow a `ModelError` as `BenchConfigError("models[<i>].<field>", …)`.
  - Then `unavailable = ADAPTERS[adapter].unavailable?.(model, env)`.
- **`agentFor`:** returns `sourceFor(entrant.model)` when `model` is set, else `fallback(run, spec)`. The CLI passes `createSource` from `server/sources.ts`.

- [ ] **Step 1: Write the failing tests** in `entrants.test.ts`, with a `sources` array holding one available live source `live-x`, one unavailable live source `live-y` (reason `"Set Y in .env"`) and a mock source `heuristic`:
  - `["heuristic"]` gives `live: false` and `kind: "baseline"`. Use the kind from the fixture source.
  - `["live-y"]` gives `unavailable: "Set Y in .env"`.
  - `["nope"]` throws with field `models[0]`, and the message includes `heuristic`.
  - An inline completion model with `apiKey: "${K}"` and `baseUrl: "https://x.test/v1"`:
    - with `env {}`, `unavailable` is `"set K in .env"`;
    - with `env { K: "k" }`, `model.apiKey` is `"k"`, `live` is `true` and `kind` is `"llm"`.
  - An inline model with `adapter: "teleport"` throws with field `models[0].adapter`.
  - `agentFor` calls `fallback` for a string entrant, and does not call it for an inline one. Use a spy fallback.
- [ ] **Step 2: Check that they fail.** Run `bun test server/bench/entrants`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `entrants.ts`.
- [ ] **Step 4: Check that they pass.** Run `bun test server/bench/entrants`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: "Resolve bench models to entrants".

### Task 3: Match plan and the headless runner

**Files:**
- Create: `server/bench/plan.ts`, `server/bench/runner.ts`, `server/bench/runner.test.ts`

**Interfaces:**
- Consumes:
  - Task 1's `BenchConfig`;
  - Task 2's `BenchEntrant`;
  - `tetris` (`src/arena/environment.ts`);
  - `DEFAULT_CONFIG`, `RunConfig`, `ArenaEvent`, `TetrisAgent` (`src/arena/types.ts`).
- Produces:

```ts
// plan.ts
export interface MatchPlan { key: string; variant: string; config: RunConfig }
/** variants → clocks → seeds; agents are the entrants in order, with agent id = entrant id and name = label. */
export function planMatches(cfg: BenchConfig, entrants: BenchEntrant[]): MatchPlan[];

// runner.ts
export interface MatchOutcome {
  key: string;
  file: string;
  /** "played" this time, "resumed" (a finished log was already there), or "skipped" (the cost limit was reached first). */
  status: "played" | "resumed" | "skipped";
  /** Stopped by the stop rule while boards were still playing. */
  stoppedEarly: boolean;
  /** Boards still playing when the match stopped. */
  unfinished: string[];
  costUsd: number;
}
export interface RunOptions {
  outDir: string;
  agentsFor(plan: MatchPlan): TetrisAgent[];
  /** "fast": simulated time as fast as possible (mock-only line-ups). "wall": 1:1 with the wall clock. */
  pace: "fast" | "wall";
  stopWhenFinished: number;
  maxCostUsd?: number;
  onMatch?(outcome: MatchOutcome, index: number, total: number): void;
}
export function quorum(boards: number, share: number): number;   // max(1, ceil(boards × share − 1e-9))
export function outcomeOf(key: string, file: string, events: ArenaEvent[]): Omit<MatchOutcome, "status">;
export async function runMatches(plans: MatchPlan[], opts: RunOptions): Promise<MatchOutcome[]>;
export async function writeManifest(outDir: string, cfg: BenchConfig, outcomes: MatchOutcome[]): Promise<void>;
```

Behaviour:
- **`planMatches` config:** `{ ...DEFAULT_CONFIG, seed, mode: clock, targetLines: goal === "sprint40" ? 40 : 0, maxDurationMs, maxPieces, agents }`. Key format: `"described-frozen-seed1"`.
- **`runMatches`, for each plan in order:**
  1. If the running cost total is above `maxCostUsd`, push `skipped` with empty `unfinished` and `costUsd` 0.
  2. Else if `<outDir>/<key>.jsonl` exists and its last non-empty line is a `run_finished` event, read it and push `resumed` using `outcomeOf`.
  3. Otherwise create the match with `tetris.createMatch(plan.config, opts.agentsFor(plan))` and write a fresh file (truncating any partial one). Each event is written as `JSON.stringify(e) + "\n"`.
     - **Fast pace:** step 1000 ms at a time.
     - **Wall pace:** `await Bun.sleep(10)`, then step by the wall time elapsed, capped at 250 ms, as `LiveRun.tick` does.
     - Count boards done from `topout`, `survived` and `goal` events. When the count reaches `quorum(n, stopWhenFinished)` and the match isn't finished, call `match.stop()`.
     - When the match ends, push `played` with `outcomeOf`.

  Create `outDir` if it's missing. Call `onMatch` after each outcome. The cost total adds up each played or resumed outcome's `costUsd`.
- **`outcomeOf`:**
  - `costUsd` is the sum of `usage.costUsd` over `decision` events.
  - `unfinished` lists the agent ids from `run_started.config.agents` that have no `topout`, `survived` or `goal` event.
  - `stoppedEarly` is true when the last event is `run_finished` with reason `"stopped"` and `unfinished` is non-empty.
- **`writeManifest`** writes `bench.json`, two-space indented: `{ name, environment: { id: tetris.id, version: tetris.version }, createdAt (ISO), gitCommit (from git rev-parse HEAD via Bun.spawnSync, or null if that fails), config: cfg, matches: outcomes }`.

- [ ] **Step 1: Write the failing tests** in `runner.test.ts`. Use mock entrants (`jev`, `llm-fast`, `heuristic`, `random`) and `agentsFor` built from `mockSourceFor(plan.config, spec)`, with `cfg = parseBench({ name: "t", seeds: [1], clocks: ["frozen","realtime"], tetris: { maxPieces: 40 }, models: [...] })`. Use a fresh temp `outDir` per test (`mkdtempSync` in the OS temp dir).
  - `planMatches` gives keys `["described-frozen-seed1","described-realtime-seed1"]`. Agent ids equal entrant ids, and `targetLines` is 0. With `goal: "sprint40"` it is 40.
  - `quorum(1, 0.75) === 1`, `quorum(4, 0.75) === 3`, `quorum(12, 0.75) === 9`, `quorum(2, 0.75) === 2`, `quorum(3, 1) === 3`.
  - Run both plans fast:
    - two files exist, and each ends with a `run_finished` line;
    - every outcome is `played`;
    - `onMatch` was called twice with totals of 2.
  - **Stop rule.** Use 4 boards whose `agentsFor` gives three stub agents that never answer, so their pieces fall where gravity takes them and they top out within seconds of simulated time. The fourth board gets `mockSourceFor` for `heuristic`. Use `maxPieces: 1000`. The realtime match:
    - stops with 3 boards done, and `run_finished.reason` is `"stopped"`;
    - its outcome has `stoppedEarly: true` and `unfinished` of length 1.
  - **Resume.** After a full run:
    1. Overwrite the frozen file with only its first 10 lines, a crash mid-match.
    2. Record the realtime file's `mtimeMs`.
    3. Run again.

    The frozen outcome is `played` and its file again ends with `run_finished`. The realtime outcome is `resumed`, and the file's `mtimeMs` is unchanged.
  - **Cost limit.** Give the `agentsFor` stub an agent that answers `option_1` with `usage.costUsd = 1` after 10 ms of simulated time, and set `maxCostUsd: 0.5`. The first match is `played` and the second is `skipped`.
  - **Manifest.** `writeManifest` with a cfg holding an inline model with `apiKey: "${K}"`, while `Bun.env.K` is unset:
    - `bench.json` contains `"${K}"`;
    - `environment.id` is `"tetris"`;
    - `matches` has the given length.
- [ ] **Step 2: Check that they fail.** Run `bun test server/bench/runner`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `plan.ts` and `runner.ts`.
- [ ] **Step 4: Check that they pass.** Run `bun test server/bench/runner`. Expected: PASS within about 10 s. If the stop-rule test takes longer, lower `maxDurationMs` in that test rather than changing the runner.
- [ ] **Step 5: Commit.** Message: "Headless runner: matches, stop rule, resume, cost limit, manifest".

### Task 4: Preflight and the estimate

**Files:**
- Create: `server/bench/preflight.ts`, `server/bench/preflight.test.ts`

**Interfaces:**
- Consumes:
  - Task 2's `BenchEntrant`;
  - Task 1's `BenchConfig`;
  - `TestResult` (`server/sample.ts`);
  - `DEFAULT_CONFIG.entryDelayMs`.
- Produces:

```ts
export interface Check { id: string; label: string; ok: boolean; detail: string; latencyMs?: number; costUsd?: number }
/** One real answer per live entrant, all at once. Mocks pass without a call; unavailable entrants fail without one. */
export async function preflight(entrants: BenchEntrant[], test: (e: BenchEntrant) => Promise<TestResult>): Promise<Check[]>;
export interface Estimate { matches: number; pace: "fast" | "wall"; maxMinutes: number; maxCostUsd: number }
export function estimate(cfg: BenchConfig, entrants: BenchEntrant[], checks: Check[]): Estimate;
export function paceFor(entrants: BenchEntrant[]): "fast" | "wall";   // "wall" if any entrant is live
export function formatChecks(checks: Check[]): string;                 // one aligned line per check: ✓/✗, label, latency, detail
export function formatEstimate(e: Estimate): string;
```

Rules:
- **`preflight` details** for each entrant:
  - unavailable: `{ ok: false, detail: unavailable }`;
  - mock: `{ ok: true, detail: "mock, no API calls" }`;
  - live: `test(e)`, with `ok` true when `status === "ok"`; `detail` is `` `chose ${choice} from ${options} options` `` or the result's `detail`; `latencyMs` and `costUsd` come from the result. A thrown error becomes `{ ok: false, detail: message }`.
- **`estimate`** (an upper bound, which the output must say):
  - `matches` is variants × clocks × seeds.
  - `maxMinutes` is `matches × maxDurationMs / 60000` for wall pace, and 0 for fast.
  - `maxCostUsd` is the sum over ok live checks of `costUsd × turns × matches`, where `turns = min(maxPieces, ceil(maxDurationMs / (latencyMs + entryDelayMs)))`.

- [ ] **Step 1: Write the failing tests** in `preflight.test.ts`:
  - `paceFor` gives `"fast"` for mock-only entrants and `"wall"` when one is live.
  - `preflight` with an unavailable entrant fails it without calling `test` (use a spy), and still checks the other live entrant.
  - A mock entrant passes with detail `"mock, no API calls"`.
  - A `test` that throws becomes a failed check carrying the message.
  - For 1 variant, 2 clocks and 3 seeds, `estimate` gives `matches: 6`.
  - With a live check at `costUsd 0.001`, `latencyMs 300`, `maxDurationMs 60000` and `maxPieces 1000`:
    - `turns = ceil(60000/500) = 120`;
    - `maxCostUsd` is about `0.001 × 120 × 6 = 0.72` (`toBeCloseTo`);
    - `maxMinutes` is 6.
  - `formatEstimate` output includes `"at most"`.
- [ ] **Step 2: Check that they fail.** Run `bun test server/bench/preflight`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `preflight.ts`.
- [ ] **Step 4: Check that they pass.** Run `bun test server/bench/preflight`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: "Bench preflight and time/cost estimate".

### Task 5: The `bun bench` commands

**Files:**
- Create: `server/bench/cli.ts`, `server/bench/cli.test.ts`
- Modify: `package.json`. Add the script `"bench": "bun server/bench/cli.ts"`.

**Interfaces:**
- Consumes everything above, plus:
  - `listSources`, `refreshHealth`, `createSource`, `models` (`server/sources.ts`);
  - `testModel` (`server/sample.ts`).
- Produces:

```ts
export interface Io { out(text: string): void; confirm(question: string): Promise<boolean> }
/** Runs one command; returns the process exit code. */
export async function main(argv: string[], io: Io): Promise<number>;
export const DEMO: BenchConfig;   // name "demo"; mocks jev, llm-fast, llm-frontier, llm-flaky, heuristic, random; seeds [1]; both clocks
```

`cli.ts` ends with `if (import.meta.main) process.exit(await main(process.argv.slice(2), { out: console.log, confirm: async (q) => (prompt(`${q} [y/N]`) ?? "").trim().toLowerCase() === "y" }))`.

The commands:
- **`init [file=bench.yaml] [--force]`:**
  1. Copy `bench.example.yaml` to the file. If the file exists and there's no `--force`, refuse with exit code 1.
  2. If `.env` is missing, copy `.env.example` to `.env` and say so.
  3. Print the next steps: edit `bench.yaml`, put keys in `.env`, run `bun bench doctor`.
- **`doctor [file=bench.yaml]`:**
  1. Check that `Bun.semver.satisfies(Bun.version, ">=1.4.0")`.
  2. Run `loadBench`, `await refreshHealth()`, `resolveEntrants(cfg.models, listSources(), Bun.env)`, then `preflight` with `test = (e) => testModel(e.model ?? models.resolve(e.id))`.
  3. Print `formatChecks` and `formatEstimate`.
  4. Exit 0 only if every check is ok.
  5. A `BenchConfigError` prints `"<file>: <message>"` and exits 1.
- **`run [file=bench.yaml] [--yes] [--out dir]`:**
  1. Run the doctor's steps. Any failed check stops it with exit 1.
  2. For wall pace, unless `--yes`, `io.confirm("Start?")`. A "no" exits 0 with "Not started."
  3. Run `runMatches` with:
     - `pace: paceFor(entrants)`;
     - `agentsFor` building each agent with `agentFor(entrants[i], plan.config, plan.config.agents[i], createSource)`;
     - `outDir` from `--out`, or `runs/bench/<name>`;
     - `onMatch` printing `"[i/total] key: status (n unfinished)"`.
  4. Then run `writeManifest` and `Bun.spawn(["bun", "scripts/stats.ts", ...played and resumed files], { stdout: "inherit" })`.
- **`demo [--out dir]`:** runs `DEMO` exactly like `run`, skipping preflight and confirmation, since mocks make no calls.
  - Then it prints:
    - the output folder;
    - `"Replay a match: bun dev, then open the page and load a .jsonl file from <dir>"`;
    - `"Next: bun bench init"`.
  - The default `outDir` is `runs/bench/demo`.
- **No command, or `help`:** prints usage (the four commands, one line each) and exits 0. An unknown command prints the usage and exits 1.

- [ ] **Step 1: Write the failing tests** in `cli.test.ts`. Capture output with an `Io` stub, and run in a temp working directory by passing absolute paths:
  - `main(["init", tmp/bench.yaml])` writes the file, and its content equals `bench.example.yaml`. A second call returns 1, and `--force` returns 0.
  - `main(["doctor", file])`, where the file has an inline model `apiKey: "${BENCH_TEST_UNSET_KEY}"` plus `heuristic`:
    - returns 1;
    - the output contains `BENCH_TEST_UNSET_KEY` and `mock, no API calls`.
  - `main(["doctor", file])` on a file containing `apiKey: "sk-123"` returns 1, and the output contains `models[0].apiKey`.
  - `main(["demo", "--out", tmpDir])` with `DEMO` overridden to `maxPieces: 30` returns 0 and writes `bench.json` with 2 matches. To make the override possible, export `demoConfig(overrides?: Partial<BenchConfig>): BenchConfig`, which `DEMO` uses.
  - `main(["fly"])` returns 1, and the output contains `"bun bench init"`.
- [ ] **Step 2: Check that they fail.** Run `bun test server/bench/cli`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `cli.ts` and the `package.json` script.
- [ ] **Step 4: Check that they pass.** Run `bun test server/bench/cli`. Expected: PASS.
- [ ] **Step 5: Run the demo for real.** Run `bun bench demo`. Expected:
  - two `[i/2]` lines, then the stats tables;
  - `runs/bench/demo/bench.json` and two `.jsonl` files;
  - finishes in well under a minute.
- [ ] **Step 6: Check `run` end to end against the fake providers.**
  1. In one terminal, run `bun scripts/fake-providers.ts`.
  2. Write a scratch config (in the scratchpad, not the repo) with the following, keeping placeholders:
     - an inline completion model at `http://localhost:5400/v1` with `apiKey: "${FAKE_KEY}"`;
     - an inline decision model at `http://localhost:5400`;
     - `heuristic`;
     - `seeds: 1`, `clocks: [frozen]`, `tetris: { maxDurationMs: 20000 }`.
  3. Run `FAKE_KEY=x bun bench run <that file> --yes --out <scratch dir>`.

  Expected:
  - a doctor table with three ✓;
  - the estimate;
  - `[1/1] described-frozen-seed1: played`;
  - the stats tables.

  Then run the same command again. Expected: `resumed`.
- [ ] **Step 7: Commit.** Message: "bun bench: init, doctor, run, demo".

### Task 6: Docs

**Files:**
- Create: `docs/bench.md`. It's the reference for `bench.yaml` (every field, its default and limits, copied from Task 1's rules) and the four commands.
  - It also covers the output layout and `bench.json`, the stop rule and "unfinished", how resume works, and why the estimate is an upper bound.
- Modify: `README.md`. Under Setup, add a short "Benchmark from the command line" block: `bun bench demo`, `bun bench init`, `bun bench doctor`, `bun bench run`, with a link to `docs/bench.md`. The full README rewrite is step 8.
- Modify: `docs/development.md`. Add `server/bench/` to the layout list, one line per file.
- Modify: `docs/design/eval-engine.md`. Record these decisions in "Runner" and mark step 3 done:
  - one JSONL per match in today's format, rather than per model, so replay and stats work unchanged;
  - matches run one at a time;
  - `repeats` and `concurrency` are deferred;
  - `demo` prints the stats until the results page exists.

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Check the docs against the code.** Every command and field named in `docs/bench.md` must exist. Check with `bun bench help` and `bench.example.yaml`.
- [ ] **Step 3: Run all checks.** Run `bun run lint && bun run typecheck && bun test`. Expected: PASS.
- [ ] **Step 4: Commit.** Message: "Docs for bun bench".
- [ ] **Step 5: Push and open the PR.** Push `bench-runner` and open a PR against `engine-core`, titled "bun bench: bench.yaml, headless runner, init/doctor/demo". The body covers:
  - what it adds;
  - the demo command;
  - the deferred items;
  - that it is stacked on #5.

  No Claude attribution.
