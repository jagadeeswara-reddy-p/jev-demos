# Benchmarks from the command line

`bun bench` plays a benchmark without the page. You describe it in a `bench.yaml`:
which models, how many seeds, which clocks, and when a match stops. It checks
every model, plays the matches one at a time, and writes the same game logs the
page writes. The page is only needed to watch a replay.

- [Quick start](#quick-start)
- [Commands](#commands)
- [bench.yaml](#benchyaml)
- [Matches and the stop rule](#matches-and-the-stop-rule)
- [Resuming and the cost limit](#resuming-and-the-cost-limit)
- [Output](#output)
- [The estimate](#the-estimate)

## Quick start

```sh
bun bench demo      # six mock models, no keys, well under a second
bun bench init      # writes bench.yaml and .env from the examples
bun bench doctor    # checks each model; one real call per live model
bun bench run       # plays the bench; asks first when it uses live models
```

Run these from the repository root. `bench.yaml` is git-ignored, so your
benchmark stays local.

## Commands

| Command | What it does |
|---|---|
| `bun bench init [file] [--force]` | Copies `bench.example.yaml` to `file` (default `bench.yaml`). Creates `.env` from `.env.example` beside it if there isn't one. Refuses to overwrite `file` unless `--force`. |
| `bun bench doctor [file]` | Runs the checks and prints the estimate. Exits 0 when every check passes, 1 otherwise. |
| `bun bench run [file] [--yes] [--out dir]` | Runs the same checks. Refuses to start if any fails. Asks `Start?` when the bench uses a live model, unless `--yes`. Then plays every match. |
| `bun bench demo [--out dir]` | Plays the built-in demo bench (below). Ignores `bench.yaml`. |
| `bun bench help` | Prints the usage. |

The output folder defaults to `runs/bench/<name>`, where `<name>` is the bench's
`name`. `--out` changes it.

**Checks.** Each one prints a line with a ✓ or ✗ and the reason:

- Bun is 1.4.0 or newer.
- Each model is available. A model whose `.env` variable is missing fails here,
  naming the variable, without a call.
- Each live model answers one real move. A model that doesn't answer a valid
  option fails.
- Mock models make no calls and always pass.

Self-hosted models with a `healthCheck` are pinged first; one that doesn't
answer is listed as unavailable (see [models.md](models.md#settings)).

**Demo.** Six mock models: Jev, Fast LLM, Frontier LLM, Flaky LLM, Heuristic bot
and Random (ids `jev`, `llm-fast`, `llm-frontier`, `llm-flaky`, `heuristic`,
`random`). Seed 1, both clocks, 300 pieces or 120 seconds per match. It makes no
API calls, so it finishes in about a second and then prints the stats of its
logs. To watch one of its matches, run `bun dev`, open the page and load a
`.jsonl` file from the output folder.

## bench.yaml

Start from `bench.example.yaml`, which has every field with a comment. Unknown
keys are an error, and every error names the field.

| Field | Default | Meaning |
|---|---|---|
| `name` | required | Lowercase letters, digits and dashes, up to 40. Names the default output folder. |
| `environment` | `tetris` | The game. Only `tetris` exists. |
| `seeds` | `5` | A number `n` means seeds 1 to n (up to 100). Or a list of 1 to 100 different whole numbers, 0 or more, such as `[7, 9]`. |
| `clocks` | `[frozen, realtime]` | Any of `frozen` (turn timer paused) and `realtime` (live clock). |
| `variants` | `[described]` | Rule variants. Tetris has `described` only. |
| `tetris.goal` | `survive` | `survive` (last as long as possible) or `sprint40` (clear 40 lines). |
| `tetris.maxDurationMs` | `600000` | Longest a match may run, from 10000 to 3600000 ms (10 seconds to 1 hour). |
| `tetris.maxPieces` | `1000` | Most pieces a board may place, from 1 to 10000. |
| `limits.stopWhenFinished` | `0.75` | Share of boards that must be finished before a match stops. More than 0, at most 1. See below. |
| `limits.maxCostUsd` | none | Spend cap for the whole bench, in USD, greater than 0. Off unless set. |
| `models` | required | 1 to 12 entries. Each is a model id (a string) or an inline model (an object). |

**Model ids.** A plain id names a model that the page knows: a built-in from
`models.json` (such as `live-jev`, `live-clef`, `bedrock-opus`), a model added
in the page (saved in `models.local.json`), or a mock (`jev`, `llm-fast`,
`llm-frontier`, `llm-flaky`, `heuristic`, `random`). An unknown id is an error
that lists the known ids. Each id can appear once.

**Inline models.** An object takes the same settings as an entry in
`models.json`, listed in [models.md](models.md#settings). Required: `id`,
`label`, `adapter`, `model`, and `baseUrl` (or `url`) for the completion and
decision adapters. The `apiKey` must be a placeholder such as
`"${OPENROUTER_API_KEY}"`. A literal key is refused at load time. The value is
read from `.env` when the bench starts. If the variable is not set, the model
is unavailable and the check names it.

Keys stay in `.env`. The bench's output stores the placeholder, never the key.

## Matches and the stop rule

A **match** is one seed on one clock and one variant. Every model in the bench
plays its own board in that match, and all of them get the same pieces. The
matches run in order: variants first, then clocks (frozen before realtime), then
seeds. One match finishes before the next starts.

**Stop rule.** A board is *done* once it has topped out, survived, or reached
the goal. A match stops as soon as `ceil(models × stopWhenFinished)` boards are
done, with at least one. Boards still playing then are **unfinished**. Their
partial logs are kept, and `bench.json` lists them under `unfinished`. With four
models and the default 0.75, a match stops when three boards are done.

**Wall-clock pace.** A bench with any live model runs every match on the wall
clock, frozen matches included, so a match takes up to `maxDurationMs`. A bench of
mock models only runs as fast as the machine can simulate, and the estimate says
it needs no waiting.

## Resuming and the cost limit

Each match writes its own log, named by its key (below). When you run again:

- A log that ends with a finished match is **resumed**: it is read, not played.
- A log that was cut short (the run stopped mid-match) is **played again** from the
  start, and the file is overwritten.
- A match whose spend so far is over `limits.maxCostUsd` is **skipped**. Nothing
  is written for it. The match that crosses the cap still finishes.

Resume works by file name only. If you change the models or settings of a
bench whose matches are already finished, those matches are resumed, not
replayed. To replay one, delete its `.jsonl` file, or run with a new `--out`
folder.

## Output

```
runs/bench/<name>/
  described-frozen-seed1.jsonl
  described-realtime-seed1.jsonl
  ...
  bench.json
```

Each `<variant>-<clock>-seed<seed>.jsonl` is a run log in the same format the
page saves. `bun run stats <files>` reads it, and the page replays it.

`bench.json` is the manifest, written after the last match:

| Key | Contents |
|---|---|
| `name`, `environment` | The bench's name, and the environment's `id` and `version`. |
| `createdAt`, `gitCommit` | When the run wrote the manifest; the commit of the code that ran (`null` if git is not available). |
| `config` | The bench as read, with defaults filled in: `seeds` as a list, the `tetris` and `limits` fields moved to the top level. Model entries are as written, with `${ENV}` placeholders kept. |
| `matches` | One entry per match, in order: `key`, `file`, `status` (`played`, `resumed` or `skipped`), `stoppedEarly`, `unfinished` (the ids still playing), `costUsd`. |

`stoppedEarly` is true when the stop rule ended the match while boards were
still playing. `costUsd` is the sum of the match's answer costs, read from its
log. A model without `prices` costs $0.

## The estimate

`doctor` and `run` print an estimate before anything plays. It is an upper bound.

- **Time** (only with a live model): `matches × maxDurationMs`. Matches are
  assumed to run to their full length. Early stops only make it shorter.
- **Cost**: for each live model, its cost per move from the check, times the
  number of moves it could make, summed over the matches. The moves are
  `min(maxPieces, ceil(maxDurationMs / (latency + 200 ms)))`, where the latency
  is from the check and 200 ms is the entry delay of a piece. Every model is
  assumed to play every match to the end. The `maxCostUsd` cap is not applied to
  the estimate.

`matches` is `variants × clocks × seeds`. The estimate is rounded up, so the
printed figure never undershoots.

The check itself is one real move, so the latency and the cost per move come from
a single answer. Treat the figure as a ceiling, not a forecast.
