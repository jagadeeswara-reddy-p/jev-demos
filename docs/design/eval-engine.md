# Design: a benchmark engine for real-time decisions

Status: draft for review, 2026-10-27. Nothing here is built yet.

## Goal

Anyone can bring up to 12 models over an API, describe them in one config
file, run a benchmark, and publish results that others can check. The
benchmark compares **judgement, 2D (spatial) reasoning and speed separately**,
not one "intelligence" number.

Tetris is the first environment. Browser automation comes later, and the engine
must take it without changing the core.

## Non-goals (for now)

- Bring-your-own *agents* (Browser Use, computer-use stacks) as black boxes.
  Every model plays through our harness: same prompt, same observation, same
  action format.
- Hosting a public leaderboard service. Publishing means a static results page
  plus the raw logs.

## Shape of the engine

```
bench.yaml ──► Runner ──► Episodes ──► Event log (JSONL) ──► Scorer ──► Results bundle ──► Results page
                 │            │
                 │            ├── Environment plugin (tetris, later browser)
                 │            └── Model adapter (completion, decision, bedrock, …)
                 └── seeds × variants × models, concurrency, limits, cost estimate
```

The page becomes a viewer: it watches a run live or replays its logs. It
no longer decides how many models a benchmark can have.

### Core terms

| Term | Meaning |
|---|---|
| **Environment** | A plugin that knows one task family: Tetris, later Browser. |
| **Variant** | A named setting of an environment that changes what is measured, e.g. Tetris `described` vs `board-only`. |
| **Clock** | `realtime` (the world moves while the model thinks) or `frozen` (it waits, up to a timeout). Shared by every environment. |
| **Episode** | One model playing one environment, one variant, one clock, one seed. The unit of scoring and logging. |
| **Match** | Episodes with the same environment, variant, clock and seed, run side by side so they can be watched together (the Tetris screen). Up to 12. |
| **Turn** | One request to a model and its answer. |
| **Run** | Everything one `bench.yaml` produces. |

Episodes are independent: a Tetris board never affects another board, and
browser tasks will run in separate browser contexts. A match only lines them up
on the same clock for viewing and for a fair start.

### Environment plugin

As built in step 1 (`src/core/types.ts`). An environment creates a whole
**match**, because shared things like Tetris's level clock belong to the
match, not to one model:

```ts
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
```

The Tetris environment is `src/arena/environment.ts`, wrapping
`ArenaSimulation`. A browser environment implements the same shape, with
`step` driving Playwright. Still to come:
- `parseConfig`, with `bench.yaml` (step 3);
- `score` and `metrics`, with the results bundle (step 5): per-episode numbers
  such as pieces landed or task success, and how the results page ranks them.

### Turns: the one thing adapters see

Adapters don't know about Tetris. They turn a generic `Turn` into one API
call. Step 1 shipped the `choice` action and text observations. The `tool`
action, images, `throttled` and `providerRequestId` below are still to come.

```ts
interface Turn<D = unknown> {
  id: string;
  instructions: string;                 // system text
  observation: Part[];                  // text now; images later (screenshots)
  action:
    | { kind: "choice"; options: { id: string; text: string }[] }   // Tetris; also browser "pick an element"
    | { kind: "tool"; schema: JsonSchema };                         // free-form actions, e.g. click(bid), type(bid, text)
  deadlineMs: number;
  requestedAt: number;                  // simulated time the turn was asked
  detail: D;                            // the environment's own view, for mocks and baselines; adapters never read it
}
interface Answer {
  status: "ok" | "invalid" | "error" | "throttled";
  value?: unknown;                      // option id, or the tool call's arguments
  probabilities?: Record<string, number>;
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
  latencyMs: number;
  providerRequestId?: string;           // the provider's id for the call, kept so published logs can be cross-checked
}
```

- **Decision** adapter (`/v1/systemone`) supports `choice` only. A browser
  variant that offers a menu of actions keeps decision models in the game; a
  free-form one marks them "not applicable" rather than failing them.
- **Completion** and **Bedrock** adapters support both kinds.
- `throttled` is new: a 429 from a provider is logged as such, so a shared
  rate limit doesn't look like a slow model.

### Tetris variants: the 2×2

| | **frozen** clock | **realtime** clock |
|---|---|---|
| **described**: each option lists lines, holes, height, bumpiness (today) | judgement | judgement + speed |
| **board-only**: each option lists only rotation and columns | 2D reasoning | 2D + speed (the full game) |

Speed is also reported on its own: median and p90 answer time, and the share
of answers that came too late. Best-move rank (the reference heuristic) is
recorded for every answer in every cell, so judgement is separate from
survival.

This reverses the earlier decision to leave out a board-only view. Decision
models keep the `described` column where they are strongest. Language models
get a column that tests what they claim to do well.

## Config: `bench.yaml`

```yaml
name: oct-2026-open
environment: tetris
seeds: [1, 2, 3, 4, 5]          # or a count: `seeds: 5` means 1–5; default 5
clocks: [frozen, realtime]
variants: [described, board-only]
repeats: 1                       # >1 repeats each episode, for pass^k-style consistency
tetris:                          # environment block, validated by the plugin
  goal: survive                  # or sprint40
  maxDurationMs: 600000
limits:
  stopWhenFinished: 0.75         # end a match once this share of its models are done; the rest are "unfinished"
  maxCostUsd: 50                 # stop scheduling new episodes past this
  concurrency: 12                # episodes in flight at once
models:                          # 1 to 12
  - id: jev
    adapter: decision
    baseUrl: https://api.typesafe.ai
    model: jev-latest
    apiKey: ${TYPESAFE_API_KEY}  # keys only ever come from env
    prices: { inputPerM: 0.042, outputPerM: 0 }
  - id: my-llm
    adapter: completion
    baseUrl: https://openrouter.ai/api/v1
    model: vendor/model
    apiKey: ${OPENROUTER_API_KEY}
```

- Model entries use today's `models.json` fields unchanged, so the page's
  model form and the file stay one format. YAML and JSON are both accepted.
- A literal key in the file is refused. Keys come from `${ENV}` only, which
  keeps published configs safe.

## Runner

`bun bench run bench.yaml`:

1. Validates the config and each model's adapter fields.
2. **Preflight**: one real turn per model, then an estimate of time, tokens
   and cost for the whole run. Waits for confirmation (`--yes` skips).
3. Schedules matches: for each environment × variant × clock × seed, start
   all models together on one clock. Realtime matches run one at a time, so
   models don't compete with other matches for network or rate limits. Frozen
   matches may run in parallel.
4. **Ends a match early** once `stopWhenFinished` of its models are done
   (default 3 of 4, i.e. 9 of 12): topped out, reached the goal, or hit the
   piece or time limit. The others stop where they are and are marked
   **unfinished** (see "Unfinished episodes" below). One slow model can't hold up
   a whole run, and the time and cost estimate stays honest.
5. Writes each episode's events to `runs/<run>/<match>/<model>.jsonl` as it
   goes. A crashed run resumes from the episodes not yet finished.
6. Scores and writes the results bundle.

### Unfinished episodes

An unfinished episode keeps its partial log and is shown as **unfinished**
with how far it got. It is never shown as a loss or a crash.

- **Per-turn metrics** count every answer it gave: best-move rate, latency,
  too-late rate, cost per turn.
- **Episode metrics**, such as pieces landed or lines, are shown as "≥ N" (at least N).
- **Ranking**:
  - Survive goal: an unfinished board was still alive when the match stopped,
    so it ranks above every board that topped out. The early stop is
    therefore never a penalty.
  - Sprint goal: an unfinished board hadn't reached the line target, so it
    ranks by lines cleared, as boards that fell short already do.
  - Frozen clock: unfinished usually means a slow model. The results page
    shows how many pieces it played, so a high best-move rate over 15 pieces
    isn't mistaken for one over 150.
- An environment can override this rule. Browser tasks, for example, may
  count unfinished as failed.

The page can start the same thing from the Models panel. Both go through one
runner, so a run started in the page is a benchmark too.

## Event log

Every event has the same envelope; the payload belongs to the environment:

```json
{ "t": "turn", "at": 1234, "episode": "s1-realtime-described/jev", "env": "tetris", "data": { … } }
```

Core event types: `episode_started`, `turn`, `answer`, `env` (anything the
plugin emits: spawn, lock, topout), `episode_finished`. Replay, the viewer and
scoring all read only this log.

## Results bundle and publishing

```
results/oct-2026-open/
  bench.yaml          # as run, keys stripped, with resolved model ids
  manifest.json       # engine + environment versions, git commit, machine, region, dates
  summary.json        # per model × cell: mean, 95% CI over seeds, latency p50/p90, cost
  logs/…/*.jsonl      # every episode
  SHA256SUMS          # hash of every file above
  SHA256SUMS.sig      # publisher's signature over SHA256SUMS
```

### Signing

Goal: anyone can check that a published page and its logs are exactly what
the publisher ran, and who published them. To ship fast, it uses tools that
already exist and needs no key server.

1. **Hashes.** `bench publish` writes `SHA256SUMS`, the SHA-256 of every file
   in the bundle. The results page shows the hash of `SHA256SUMS` itself as the
   bundle id.
2. **Publisher signature.** The publisher signs `SHA256SUMS` with their SSH key:
   `ssh-keygen -Y sign -n decision-bench-results`. Nothing new to install or manage, and
   GitHub already publishes every user's public keys at
   `github.com/<user>.keys`. `manifest.json` names the publisher's GitHub handle.
3. **Official results** live in the project's GitHub repo. A release workflow
   packs the bundle and adds a GitHub artifact attestation
   (`actions/attest-build-provenance`). It proves the tarball came from that
   repo's workflow. The repo's `allowed_signers` file lists maintainers whose
   signatures count as official.
4. **Checking.** `bun bench verify <bundle>` re-hashes every file, checks the
   signature against `allowed_signers` (or a named GitHub user's keys), and
   recomputes `summary.json` from the logs. Anyone can also run
   `gh attestation verify <tarball> --owner <org>`.

What signing does not prove: that the model calls in the logs really happened.
To make faking harder, each `answer` event keeps the provider's request or
response id when the API returns one, and the token counts the provider
reported. Anyone with an account at that provider can then check them.

Upgrade path: Sigstore keyless signing (`cosign sign-blob`), once the project
needs signatures that don't depend on one person's SSH key.

### Publishing a run

`bun bench publish results/oct-2026-open` builds a static page: the 2×2 per
model, speed vs judgement and cost vs score plots, and a replay of any
episode. Anyone can rerun `bun bench stats` on the logs and get the same
numbers.

Reporting rules:
- Means with 95% confidence intervals over seeds, with paired comparisons
  (same seeds). Small gaps inside the interval are called ties.
- Built-in baselines in every run: **random** (catches tasks a model "wins"
  by doing nothing) and **heuristic** (a ceiling and a check that the scoring works).

## Project name, repository and website

### Name and repository

The project is **decision-bench**. The GitHub org will be named later. Until
then, docs and workflows assume **`github.com/decision-bench/decision-bench`**,
and switching to the real org is one find-and-replace. As of 2026-10-28, the
`decision-bench` and `decisionbench` GitHub orgs, the npm package and the PyPI
package are all free.

Name clash to know about: an academic benchmark called **DecisionBench**
already exists. It measures how LLM orchestrators delegate sub-tasks
(arXiv 2605.19099, May 2026, data at `huggingface.co/decisionbench`). It's a
different topic, but searches for the name will find both. The Hugging Face
org name is taken, so any datasets we host there need another name. Decided
2026-10-28: keep decision-bench, since the clash is acceptable.

`jev-demos` stays as the reference repo and the source of the 2026-10 results.

### Website

One static site, deployed to GitHub Pages from the main repo by a GitHub
Actions workflow on every push to `main`.

- **Built with Astro and its Starlight docs theme.**
  - Starlight gives search, sidebar navigation and dark mode with no setup.
  - Because it's an Astro site, it can also have non-docs pages: home, results
    and replays.
  - Pages ship almost no JavaScript, except interactive parts like the replay
    viewer, which reuse the existing React board components.
  - Docusaurus has more features (versioned docs, translations) but a heavier
    React runtime. VitePress assumes Vue. We don't need either.
- **Deploy** with Astro's official GitHub Pages workflow (`withastro/action`,
  then `actions/deploy-pages`). In repo settings, the Pages source is set to
  GitHub Actions. The site starts at `decision-bench.github.io/decision-bench`,
  with Astro's `base` set to the repo name. If a custom domain comes later,
  add `public/CNAME`, set `site` to the domain and remove `base`.
- **Code** lives in `site/` in the same repo, so docs change in the same PR
  as the code they describe. CI builds the site on every PR, so broken links
  fail the build before merge.

### Site map

| Path | What's there |
|---|---|
| `/` | What decision-bench measures, in one sentence; the latest run's 2×2 chart; the demo video; "Run your own" and "See results" buttons |
| `/results/` | Every published run: date, environment, models, a verified badge (bundle hash and signer) |
| `/results/<run>/` | One run: the 2×2 per model, speed vs judgement, cost vs score, per-seed tables, a replay of any game, download and verify instructions |
| `/docs/` | The documentation (below) |
| `/blog/` | Write-ups such as today's `findings.md` and posts in `docs/posts/` |

Published runs are copied into the site at build time from `results/<run>/`
in the repo. A bundle is about 1–5 MB of JSONL, like today's
`benchmarks/` (5.4 MB for two benchmarks). Big media such as videos go in
GitHub Releases, not in git. Today's `docs/media` is 18 MB.

### Docs structure

Organised by what the reader is trying to do (the Diátaxis split), so a
contributor finds the reference and a newcomer finds the tutorial:

```
docs/
  getting-started/      tutorial: install, add two models, run, read the results
  guides/               how-to: add a model, self-host a model, publish and sign a run,
                        verify someone else's run, write an adapter, write an environment
  reference/            bench.yaml fields, CLI commands, adapters and wire formats,
                        event log format, results bundle format, metrics
  concepts/             clocks, variants (the 2×2), fairness rules, scoring and
                        confidence intervals, unfinished episodes, what signing proves
  environments/         tetris (rules, timings, prompt), browser (when it lands)
  contributing/         code standards, tests, release process
```

Today's docs map onto this directly:
- `how-it-works.md` → concepts and environments/tetris.
- `models.md` → reference and guides.
- `configuration.md` → reference.
- `self-hosting.md` → guides.
- `findings.md` → blog.

The README shrinks to:
- the one-line pitch;
- the latest results table;
- a three-command quick start;
- a link to the site.

## 12 boards on screen

`MAX_BOARDS` becomes 12. The fight screen lays boards out by count: 3×2 up
to 6, 4×3 up to 12, with smaller boards and a one-line stats strip. Click a
board to enlarge it. Above 12, a match is still allowed headless and the page
shows the results only.

## Later: browser automation

What the browser plugin brings, without core changes:

- **Sites**: self-hosted, deterministic ones (WebArena-Verified's Docker
  sites, or small sites of our own), reset per episode. No live web for
  scored runs.
- **Observation**: accessibility tree with element ids, optional screenshot,
  as `Part[]`.
- **Actions**: `tool` turns (click, type, scroll, answer) and a `choice`
  variant listing the clickable elements, which lets decision models play.
- **Scoring**: a programmatic state check per task. An AI judge only for
  information-retrieval answers, with its agreement with humans measured and
  published.
- **Clock**: frozen with a step budget by default; a realtime variant can put
  a per-action deadline on the page, like Tetris.

Open question for then: Playwright under Bun. If it misbehaves, the plugin
runs a small Node worker that talks to the engine over stdio.

## Migration from today

1. **Done (branch `engine-core`).** Make the Tetris engine and arena an `Environment` plugin. The current UI
   keeps working through it.
2. **Done (branch `engine-core`).** Generic `Turn`/`Answer`; adapters lose `DecisionRequest`.
3. `bench.yaml` loader and the headless runner, with preflight and resume.
4. Board-only variant.
5. Results bundle, `stats`, `publish`, `verify`, with hashes and SSH
   signatures. The release workflow with attestations goes in once the
   real repo exists.
7. Website: Astro and Starlight in `site/`, the docs reorganised into it,
   results pages built from `results/`, and the Pages deploy workflow. This can
   start in parallel with step 1. Its first version needs only the existing docs
   and the 2026-10 results.
6. 12-board layout.

Each step is its own PR with tests. Old JSONL logs stay readable through a
converter, so the 2026-10-17 results keep replaying.

## Decisions

### One shared clock per realtime match

All models in a realtime match start at the same instant and run on one game
clock. Today's code already works this way. Boards stay independent: a model's
slow answer only costs its own board.

What sharing the clock buys:

- **Same deadlines at the same moment.** Levels rise every 15 s of game time,
  so at any moment every board falls at the same speed. Piece 40 might arrive
  at level 3 on a fast board and level 5 on a slow one, but that is the
  benchmark working: the slow model really did take longer.
- **Same conditions.** Every model's calls go out in the same minutes, through
  the same network, at the same time of day for provider load. Running models
  one after another would spread them over hours, and a busy hour at one
  provider would look like a slow model.
- **Side-by-side viewing.** The live screen and replays line up because every
  board shares one timeline.
- **12× shorter.** Twelve models together take as long as one game, not twelve.

What it costs, and how the design handles it:

- **Up to 12 requests in flight at once from one machine.** That's trivial for
  bandwidth. The server's own work per tick (moving 12 pieces) is microseconds,
  so it can't delay one board's answer behind another's. Preflight measures
  each model's latency alone, so any contention would show up as a difference.
- **Models that share a provider account share its rate limit.** Throttling is
  logged as `throttled`, not as a slow answer, and the results page flags
  matches where it happened.
- **Matches can't overlap.** Two realtime matches running at once would compete
  for network and rate limits, so the runner plays realtime matches one at a
  time. Frozen matches don't depend on time and may run in parallel.

### Seeds

Configurable, with no fixed number. `seeds` takes a list (`[1, 2, 3]`) or a
count (`5` means seeds 1–5); with neither it defaults to 5. The results page
shows the confidence intervals, so a run with too few seeds shows wide
intervals and ties instead of a false winner.

### Signed results

Yes; see [Signing](#signing).
