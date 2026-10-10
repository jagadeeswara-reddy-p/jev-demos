# Deadline Tetris

Deadline Tetris puts decision models side by side in the same Tetris game, piece
for piece. In the main mode the pieces keep falling while each model thinks, so
**an answer that arrives after the piece has landed doesn't count**. The point
is to compare a System One model (Jev, from TypeSafe) with regular language
models fairly. Both get identical games, identical prompts and identical rules,
and the game can be played under time pressure or without it.

It is our own take on the Jev vs Haiku vs Opus Tetris video. That video showed
only the real-time race. This version also separates **speed** from **placement
skill**, includes **baselines**, and saves every run so it can be replayed and checked.

---

## Demo

[![Live run: Jev vs gpt-6.1-sol vs claude-haiku-5-5, 4x speed](docs/media/demo.gif)](docs/media/demo.mp4)

*A full live run (seed 1, real-time clock) at 4× speed: Jev vs gpt-6.1-sol vs
claude-haiku-5-5, both through AWS Bedrock. Click for the full two-minute
recording at normal speed ([demo.mp4](docs/media/demo.mp4)).*

---

## Results so far

**Who wins a run:** the board with the most **pieces landed**, meaning pieces
the model put where it chose, in time. Ties go to more lines, then longer
survival. Every board in a run gets the same pieces, prompts and rules. Runs
stopped within the first few decisions are left out. Regenerate any of these
numbers with `bun run stats`.

### Round 2 (2026-10-10): Jev vs GPT-6.1 Sol vs Claude Haiku 5.5

**Jev** (`jev-latest`, TypeSafe API) against **gpt-6.1-sol** and
**claude-haiku-5-5**, both on AWS Bedrock through the regional `us.` inference
profiles. 5 real-time runs: four on seed 1 and one on seed 2; one played to the end and four were stopped early.
(`bun run stats --since 2026-10-10T18:40 --min-decisions 20`)

| Model | Runs | Wins | Pieces landed | Landed per run | Lines | Lines per 100 landed | Too late |
|---|---|---|---|---|---|---|---|
| **Jev** | 5 | **5** | **368** | 73.6 | 92 | 25.0 | **0 (0%)** |
| claude-haiku-5-5 | 5 | 0 | 154 | 30.8 | 39 | 25.3 | 4 (3%) |
| gpt-6.1-sol | 5 | 0 | 46 | 9.2 | 10 | 21.7 | 17 (27%) |

| Model | Decisions | Median | p90 | p95 | Fastest | Slowest | Answered in time | Tokens out per decision |
|---|---|---|---|---|---|---|---|---|
| **Jev** | 369 | **279 ms** | 318 ms | 330 ms | 251 ms | 626 ms | **100%** | 241 |
| claude-haiku-5-5 | 157 | 1.52 s | 1.60 s | 1.63 s | 1.35 s | 2.87 s | 98% | 35 |
| gpt-6.1-sol | 55 | 4.01 s | 9.27 s | 15.35 s | 1.70 s | 19.04 s | 84% | 113 |

**The run that played to the end** (seed 1, 112 s, the one in the demo):

| Model | Pieces landed | Lines | Too late | Topped out | Level reached | Cost | Cost per 1,000 decisions |
|---|---|---|---|---|---|---|---|
| **Jev** (winner) | **115** | **30** | 0 | at 88 s | 6 | $0.0081 | **$0.07** |
| claude-haiku-5-5 | 53 | 12 | 4 | at 112 s (lasted longest) | 8 | $0.0151 | $0.27 |
| gpt-6.1-sol | 12 | 2 | 11 | at 93 s | 7 | $0.0745 | $3.92 |

**What it shows**
- **Speed:** Jev answers in about 0.28 s and never missed a deadline. Haiku
  is remarkably steady at about 1.5 s (95th percentile 1.63 s) and missed 3% of
  pieces. GPT-6.1 Sol has a median of 4 s but a long tail (95th percentile 15 s),
  so 27% of its pieces fell before it answered.
- **Wins:** Jev won all five runs on pieces landed, placing about 2.4× as many
  pieces as Haiku and 8× as many as GPT.
- **Placement:** Jev and Haiku place equally well, at about 25 lines per 100
  pieces landed. GPT manages about 22. None comes near the ~40 needed to keep
  the stack from rising. Because Jev plays fastest, its stack rises fastest:
  in the full run it topped out first (88 s), while Haiku lasted longest (112 s).
- **Cost:** per 1,000 decisions, Jev $0.07, Haiku $0.27, GPT $3.92, about 56× Jev.
- **Caveats:** mostly one seed, and only one run went to the end. GPT's price
  comes from third-party Bedrock listings, not AWS's own price list. Prices
  were added partway through, so the first two runs show $0 for GPT and Haiku,
  and the cost columns above come from the full run only.

### Round 1 (2026-10-09): Jev vs dev-model-alpha

**Jev** against **dev-model-alpha** (OpenAI-compatible gateway), seed 1.
(`bun run stats --since 2026-10-09T16:20 --min-decisions 20`)

| Model | Clock | Runs | Wins | Pieces landed | Landed per run | Lines | Too late |
|---|---|---|---|---|---|---|---|
| **Jev** | real time | 5 | **5** | **523** | 104.6 | 133 | **0** |
| dev-model-alpha | real time | 5 | 0 | 16 | 3.2 | 0 | 24 |
| **Jev** | frozen | 1 | **1** | 20 | 20.0 | 3 | 0 |
| dev-model-alpha | frozen | 1 | 0 | 1 | 1.0 | 0 | 0 |

| Model | Decisions | Median | p90 | p95 | Fastest | Slowest | Answered in time | Tokens out per decision |
|---|---|---|---|---|---|---|---|---|
| **Jev** | 523 | **294 ms** | 338 ms | 361 ms | 257 ms | 626 ms | **100%** | 241 |
| dev-model-alpha | 29 | 10.5 s | 27.2 s | 31.8 s | 1.8 s | 36.8 s | 55% | 2,394 |

- dev-model-alpha reasons at length, about 2,400 output tokens for a one-line
  answer, so 60% of its pieces fell before it answered, even at the slowest levels.
- In the one run that played to the end, both boards topped out at about the
  same time (84 s and 83 s) for opposite reasons. Jev landed 113 pieces and
  buried itself; dev-model-alpha landed 3, and 11 more fell before its answer arrived.
- No prices were set for dev-model-alpha, so its cost shows as $0. The only
  frozen run lasted 10 s.

---

## Contents

1. [Quick start](#quick-start)
2. [Configuration (`.env`)](#configuration-env)
3. [How a run works](#how-a-run-works)
4. [What the models are asked](#what-the-models-are-asked)
5. [How each answer is judged](#how-each-answer-is-judged)
6. [Reading the screen](#reading-the-screen)
7. [Live, mock and replay](#live-mock-and-replay)
8. [Server API and run logs](#server-api-and-run-logs)
9. [Project layout](#project-layout)
10. [Testing and tools](#testing-and-tools)
11. [Known limitations](#known-limitations)

---

## Quick start

Requires [Bun](https://bun.sh) 1.4 or later. There is no separate frontend build: one Bun process serves the
page and the API.

```sh
bun install
cp .env.example .env   # add your keys (see below)
bun run smoke          # one real decision from each live model, to check keys and URLs
bun dev                # http://localhost:5317
```

When the server starts it prints the line-up and whether each live model is ready:

```
Deadline Tetris on http://localhost:5317/
  Line-up  live-jev, live-llm
  Jev      ready
  dev-model-alpha ready
```

Open the page, keep the line-up on **Live models**, and press **Start live run**.

---

## Configuration (`.env`)

Bun loads `.env` automatically. **Keys stay on the server.** The browser only
learns each model's display name and whether it is available. `.env` is in
`.gitignore`; `.env.example` lists every setting.

| Setting | What it does | Default |
|---|---|---|
| `PORT` | Port for the page and API | `5317` |
| `LINEUP` | Boards in the live line-up, left to right, as source ids (see below). Up to 6. | `live-jev,live-llm` |
| `TYPESAFE_BASE_URL` | TypeSafe API base URL | `https://api.typesafe.ai` |
| `TYPESAFE_API_KEY` | Jev key | — |
| `TYPESAFE_MODEL` | Jev model id | `jev-latest` |
| `TYPESAFE_LABEL` | Name shown on Jev's board | `Jev` |
| `TYPESAFE_TIMEOUT_MS` | Give up on a Jev call after this long | `30000` |
| `TYPESAFE_INPUT_PRICE_PER_M`, `TYPESAFE_OUTPUT_PRICE_PER_M` | USD per million tokens, for the cost column | `0.042`, `0` |
| `LLM_PROVIDER` | `openai` (any OpenAI-compatible `/chat/completions` endpoint) or `anthropic` | `openai` |
| `LLM_BASE_URL` | API base URL, e.g. a gateway | OpenAI or Anthropic default |
| `LLM_API_KEY` | Key for the language model | — |
| `LLM_MODEL` | Model id, e.g. `dev-model-alpha` | — |
| `LLM_LABEL` | Name shown on the board | the value of `LLM_MODEL` |
| `LLM_JSON_MODE` | `schema` (strict JSON schema), `object` (JSON mode) or `none`. Use `object` if the provider rejects schemas. | `schema` |
| `LLM_EXTRA_BODY` | JSON merged into every request, e.g. `{"reasoning_effort":"low"}` | — |
| `LLM_MAX_TOKENS` | Output token cap | provider default |
| `LLM_TIMEOUT_MS` | Give up on an LLM call after this long | `60000` |
| `LLM_INPUT_PRICE_PER_M`, `LLM_OUTPUT_PRICE_PER_M` | USD per million tokens, for the cost column | `0`, `0` |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` (or `AWS_PROFILE`) | AWS credentials for Bedrock. Temporary session credentials expire and must be refreshed. | `us-east-1` |
| `BEDROCK_MODELS` | Any number of Bedrock models as `key=model-or-inference-profile-id`, comma-separated. Each becomes a source `bedrock-<key>`. | — |
| `BEDROCK_<KEY>_LABEL` | Name shown on that model's board | the model id without the region and provider prefix, e.g. `gpt-6.1-sol` |
| `BEDROCK_<KEY>_INPUT_PRICE_PER_M`, `BEDROCK_<KEY>_OUTPUT_PRICE_PER_M` | USD per million tokens for that model | `0`, `0` |
| `BEDROCK_<KEY>_CACHE_READ_PRICE_PER_M`, `BEDROCK_<KEY>_CACHE_WRITE_PRICE_PER_M` | Prompt-cache prices for that model | the input price |
| `BEDROCK_MAX_TOKENS`, `BEDROCK_TIMEOUT_MS` | Output token cap and timeout for Bedrock calls | `1024`, `60000` |

**Changing the line-up.** Boards can't be added or removed in the page; the
line-up is set on the server. Edit `LINEUP` and restart `bun dev`. Source ids:

- `live-jev`: Jev through the TypeSafe API
- `live-llm`: the language model configured above
- `bedrock-<key>`: each model listed in `BEDROCK_MODELS`
- mock sources (simulated, no API calls): `jev`, `llm-fast`, `llm-frontier`, `llm-flaky`, `heuristic`, `random`, `no-input`

For example, `LINEUP=live-jev,live-llm,heuristic` adds a hand-written bot as a third board, for reference.

Current set-up: Jev against two models on AWS Bedrock:

```
LINEUP=live-jev,bedrock-gpt,bedrock-claude
BEDROCK_MODELS=gpt=us.openai.gpt-6.1-sol,claude=us.anthropic.claude-haiku-5-5
```

Prices used (USD per million tokens, regional `us.` inference profiles):

| Model | Input | Output | Cache read | Cache write | Source |
|---|---|---|---|---|---|
| Jev (`jev-latest`) | 0.042 | 0 | — | — | TypeSafe |
| gpt-6.1-sol | 2.20 | 11.00 | 0.11 | 2.75 | third-party Bedrock listings (OpenAI's $2 / $10 plus Bedrock's 10% regional premium) |
| claude-haiku-5-5 | 0.11 | 0.55 | 0.011 | 0.1375 | AWS Price List API |

> `.env` is read once at startup. **Restart `bun dev` after editing it.**

---

## How a run works

### Same game for everyone
- A run has a **seed**. The seed fixes the piece sequence, using the standard
  "7-bag" randomizer (every 7 pieces contain each shape once). **Every board gets
  the same pieces in the same order.**
- The same seed and settings give the same game. With mock models the whole run
  is reproducible. With live models the pieces repeat, but the models' answers can vary.
- One game proves little. For real conclusions, run several seeds (e.g. 1–10) and compare averages.

### The two clocks

| | **Real time** | **Frozen** |
|---|---|---|
| While a model thinks | gravity keeps pulling the piece down | the game waits |
| Answer counts if… | it arrives before the piece locks | it arrives within 30 s |
| What it measures | **is the model fast enough for a live loop?** | **does the model place pieces well?** |
| Speed control | live: 1× only; mock and replay: 1–8× | same |

Run both on the same seed. Real time shows speed, and frozen shows skill without speed.

### Rules and timings (defaults in `src/arena/types.ts`, `DEFAULT_CONFIG`)

| Rule | Value | Notes |
|---|---|---|
| Board | 10 × 20, plus 2 hidden rows above | pieces appear in the top visible row |
| Gravity | `(0.8 − (level−1)·0.007)^(level−1)` seconds per row | the standard Tetris speed curve: 1 s/row at level 1, under 1 ms/row by level 20 |
| Levels | +1 every **15 s** of game time, up to 20 | time-based, not line-based, so the deadline shrinks for everyone at the same pace |
| Lock delay | **500 ms** | a resting piece locks after this long |
| Entry delay | **200 ms** | pause between a lock and the next piece |
| Drop after a decision | **30 ms per row**, never slower than gravity | see below |
| Frozen-clock timeout | **30 s** per piece | |
| End of run | every board out, **1,000 pieces** placed (counts as *survived*), or **10 minutes** | |

### What happens to a piece
1. The piece appears and **the request goes out to the model straight away**,
   with a list of every landing spot (next section).
2. **If the answer arrives in time**, the piece turns and slides over the chosen
   spot at its current height, then **falls into place at the drop speed** and
   locks when it lands. The fall is part of the game, not a screen effect, so
   live runs, replays and logs all show it, and it's identical for every board.
3. **If the piece locks first** (real time), it lands wherever gravity took it,
   in its spawn rotation and column. That counts as **too late**.
4. **If the answer is invalid or the request fails**: in real time the piece
   keeps falling and lands wherever gravity takes it. On the frozen clock it
   falls straight down from where it is, as it also does when no answer arrives within 30 s.

Once a piece has locked, the next one appears after the entry delay. The model
still gets a fresh request for every piece, even if earlier answers are still in
flight.

---

## What the models are asked

### 1. Listing the legal landing spots (`candidates()` in `src/engine/game.ts`)
When a piece appears, the engine starts from the spawn position and:

1. tries **all 4 rotations** in place, skipping any that would overlap something (no "wall kicks");
2. **slides** each rotation left and right one column at a time until it hits a wall or a block;
3. **drops** it straight down from each reachable column to find where it lands;
4. **removes duplicates**: S, Z, I and O look the same in some rotations, so one option is kept per distinct set of final cells;
5. sorts by column, then rotation, and numbers them **`option_1 … option_N`**.

That gives about 9 options for O, 17 for S, Z and I, and up to 34 for T, J and L.

**"Legal" here means** every spot you can reach by turning at the top, sliding
sideways and dropping straight down. Tucking a piece under an overhang and
T-spins aren't included. This is the usual simplification in Tetris AI
benchmarks, and it gives every model the same fixed menu to choose from.

### 2. Describing each option (`src/arena/prompt.ts`)
For every option the engine places the piece on a copy of the board and
measures the result. Both models receive **the same text, word for word**:

```
Instructions: You are playing Tetris. Choose where the current piece should land.
Good placements clear lines, avoid creating holes, and keep the stack low and flat.

Board, 10 columns by 20 rows, top row first ("#" filled, "." empty):
..........          (12 empty rows omitted here)
...####...
..#.####..
.###.###..
##...##...
#....##...
#....#....

Current piece: S
Next pieces: T, I, J
Level: 3

option_1: Rotation 1, columns 1-2, lands 5 rows above the floor; clears no lines, creates 2 holes; stack height after: 7, bumpiness after: 9.
option_2: Rotation 0, columns 1-3, lands 5 rows above the floor; clears no lines, creates 1 hole; stack height after: 6, bumpiness after: 7.
…
```

- **Lines cleared**: full rows this placement would complete.
- **Holes created**: new empty cells with a block somewhere above them (negative means it uncovers some).
- **Stack height after**: height of the tallest column.
- **Bumpiness after**: total height difference between neighbouring columns (lower is flatter).

**Why the options come with these numbers (on purpose).** Jev is a System One
model. It doesn't plan or work through board geometry step by step: it reads a
state and a set of predefined options, and returns a probability for each one.
So this arena asks the question that kind of model is built for: *given clear
descriptions of every legal move, how quickly and how well can you pick one?*
The engine does the geometry, and the model does the choosing. The language
model gets exactly the same descriptions, so neither side has more information.
For that reason there is deliberately no "board only" variant, where options
would carry just a rotation and columns: it would test spatial reasoning, which
is not the comparison this project is about.

### 3. Sending it

| | Jev (`server/sources/jev.ts`) | Language model (`server/sources/llm.ts`) |
|---|---|---|
| Request | `POST {TYPESAFE_BASE_URL}/v1/systemone` | `POST {LLM_BASE_URL}/chat/completions` (or Anthropic `/v1/messages`) |
| Board text | the `state` field | the user message |
| Options | a `choice` question with one entry per option (`option_N` → description) | listed as `option_N: description` lines after the board |
| Answer | `choice`, a probability for every option, and a `confidence` | strict JSON `{"choice":"option_N"}`; the schema only allows the offered ids (Anthropic: a forced tool call) |

**AWS Bedrock models** (`server/sources/bedrock.ts`) get the same system and
user text as the language model above. They go through Bedrock's Converse API,
which uses one request shape for every provider, and answer with a forced
`choose_placement` tool call whose `choice` is limited to the offered ids.
Bedrock caches OpenAI prompts automatically and reports cache reads and writes
separately, so those are counted as input tokens to keep the token columns comparable.

**Latency** is measured on the server's clock, from just before the request to
just after the response is read, so it **includes the network round trip**, as
a real game loop would experience it.

---

## How each answer is judged

The game checks every answer against its own list of options. Nothing is
guessed from free text.

| Status | Meaning | Where it shows |
|---|---|---|
| **ok** | arrived in time and named a valid option; the piece goes there | "decided in X" |
| **too late** | the piece locked before any answer arrived | *Too late* stat, "no answer in X, piece dropped" |
| **late** | the answer for an already-locked piece finally arrived (it tells you how late) | Log |
| **invalid** | not valid JSON, or not one of the offered ids | *Bad answers*, Log |
| **error** | HTTP error, timeout or network failure | *Bad answers*, Log |
| **blocked** | only in the optional `movement: "path"` mode: the chosen spot couldn't be reached from where the piece had fallen | *Bad answers*, Log |
| **timeout** | frozen clock only: no answer within 30 s | Log |

**Cost** = tokens × the per-million prices from `.env`. The providers report the token counts.

---

## Reading the screen

The title and summary run across the top. Below them, the figures are on the
left and the settings and log are on the right. **On screens wider than 1100 px
the whole page fits in one window, with no page scroll.** The boards grow or shrink to fill
the height left over, and the log scrolls inside its own panel. On narrower
screens the page scrolls and the right column moves under the boards.

**Right column**
- **Level readout**: current level, how fast pieces fall ("a row every …"), game time, clock and seed.
- **Settings**: Line-up, Clock, Speed, Seed (↻ picks a random one), Theme (System / Light / Dark, saved in this browser), and the buttons **Start run**, **Replay**, **Export log** and **Load log**. Space pauses or resumes a mock run or replay.
- **Log**: misses, failures and milestones, newest first.

**Left column**
- **Survival (FIG_001)**: one line per board on the shared game clock. Ticks are line clears; × marks where a board topped out and a square marks a board that survived. Each row ends with its pieces landed and lines. When the run ends it becomes **Results**, ranked by **most pieces landed** (the winner), then lines, then time survived. It keeps the same height before, during and after a run.
- **Boards (FIG_002 onward)**, each with:
  - **Deadline bar**: time spent thinking against the time left before the piece locks. Hatched means the deadline passed.
  - **The board**. In the gutter: the next 3 pieces, and labels with arrows pointing at:
    - **solid outline + "OPT N, xx% chosen"**: where the model put the last piece;
    - **dashed outlines + "OPT N, xx%"**: the two strongest alternatives the model considered.
  - **Stats**: **Landed** (pieces placed where the model chose, in time), Lines, Pieces (all that locked, including ones that fell without an answer), Decision p50/p95 (median and 95th-percentile answer time), Too late, Bad answers, Cost.

**Are the outlines real?**
- **Live Jev**: yes. The chosen spot is Jev's `choice`, and the dashed outlines and percentages are Jev's own probabilities from the API (top 2 alternatives at 1% or more).
- **Live language model**: the chosen spot is real. There are **no dashed alternatives**, because a chat model returns only a choice, without probabilities.
- **Mock models**: simulated. A pretend model picks randomly, weighted toward the hand-written bot's favourite spots.
- **The option list itself is always real**: OPT numbers are the `option_N` ids both models were sent.

---

## Live, mock and replay

| | Live | Mock | Replay |
|---|---|---|---|
| Where it runs | on the server (it holds the keys) | in the browser | in the browser |
| Models | real APIs | simulated profiles | whatever the log recorded |
| Speed | **1× only** | 1–8× | 1–8× |
| Pause | no | yes (Space) | yes (Space) |
| Saved to `runs/` | yes, automatically | no; use **Export log** | — |

**Why live runs can't be fast-forwarded:** a real API call takes as long as it
takes. At 8×, Jev's 0.3 s of real waiting would count as 2.4 s of game time and
make it unfairly late. To watch a live run faster, let it finish, then press
**Replay**, or **Load log** with a file from `runs/`, and pick 2–8×. Replays
redraw the recorded events; nothing is re-decided.

**Mock profiles** (`src/mock/profiles.ts`) imitate kinds of models:

| Id | Behaves like | Typical decision time |
|---|---|---|
| `jev` | System One model, returns probabilities | ~0.28 s |
| `llm-fast` | small chat model | ~0.75 s |
| `llm-frontier` | large reasoning model, better picks | ~6 s |
| `llm-flaky` | chat model with bad answers, errors and hangs | ~1.2 s |
| `heuristic` | hand-written evaluator (Pierre Dellacherie's), always its best spot | ~3 ms |
| `random` | any legal spot | ~1 ms |
| `no-input` | never answers | — |

With the default rules the mocks reproduce the video. The `llm-fast` mock tops
out around level 13 with about 9 late pieces, and the `llm-frontier` mock around level 5–7.

---

## Server API and run logs

**Statistics:** `bun run stats` reads every log in `runs/` and prints per-run
and per-model tables: wins, pieces landed, lines, too-late rate, answer-time
percentiles, in-time/late/invalid/error counts, deadline margin, tokens, cost
and Jev's confidence. Options: `--since <UTC time>`, `--min-decisions <n>`,
`--json <file>`, or a list of log files. Stopped and cut-off runs are handled.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/sources` | every source with its name, kind, and whether it's available (never keys) |
| GET | `/api/lineup` | the live line-up from `LINEUP` |
| POST | `/api/runs` | start a live run (body: run config); returns its id |
| GET | `/api/runs` | saved runs, newest first |
| GET | `/api/runs/:id/events` | server-sent event stream; catches up from the start, then goes live; resumes after a reconnect |
| GET | `/api/runs/:id/log` | the saved run as JSONL |
| POST | `/api/runs/:id/stop` | stop a run |

**Run logs** are saved to `runs/<timestamp>-seed<N>.jsonl`, one event per line.
The page's **Export log** produces the same format, so any log can be loaded and replayed.

| Event | When |
|---|---|
| `run_started` | first line; includes the full config |
| `level` | each level change, with the new gravity |
| `spawn` | a piece appears, with its legal options and its deadline |
| `move` | the piece moved (gravity or the drop after a decision) |
| `decision` | an answer arrived: status, choice, probabilities, latency, tokens, cost |
| `lock` | a piece locked: its cells, rows cleared, and the board after |
| `topout` / `survived` | a board finished |
| `run_finished` | last line: `all_out`, `time_limit` or `stopped` |

---

## Project layout

```
server/                 Bun server: page + API, live runs, settings
  index.ts              routes
  config.ts             reads .env
  runs.ts               live runs on the wall clock, SSE, saving logs
  sources/              decision sources: jev.ts, llm.ts (OpenAI-compatible / Anthropic),
                        bedrock.ts (AWS Bedrock), live.ts (timing, errors), registry.ts
src/engine/             game rules: pieces, board, gravity, landing spots, the hand-written evaluator
src/arena/              the shared core
  simulation.ts         one run: clock, levels, deadlines, decisions, drops, events
  prompt.ts             the text both models receive
  types.ts              config, events, decision sources, DEFAULT_CONFIG
  serverBackend.ts      browser ↔ server (live runs)
  replayBackend.ts      replays and JSONL import/export
src/mock/               mock profiles and the in-browser mock backend
src/ui/                 React + canvas UI, theme, store
scripts/                stats.ts, smoke.ts, probe-bedrock.ts, fake-providers.ts, Playwright helpers (*.mjs)
docs/media/             demo recording (MP4) and preview (GIF)
runs/                   saved live runs (git-ignored)
```

---

## Testing and tools

```sh
bun run stats               # statistics from saved runs (see "Results so far")
bun test                    # engine and simulation tests
CALIBRATE=1 bun test        # also print how each mock profile fares
bun run typecheck
bun run smoke               # one real decision from every configured live model
bun scripts/probe-bedrock.ts <model-id>   # raw Bedrock usage and answer for the real prompt
bun run fake-providers      # stand-in TypeSafe / OpenAI / Anthropic APIs on :5400
```

**Rehearsing without keys or cost:** start `bun run fake-providers`, then run the
server pointed at it:

```sh
TYPESAFE_BASE_URL=http://localhost:5400 TYPESAFE_API_KEY=fake \
LLM_BASE_URL=http://localhost:5400/v1 LLM_API_KEY=fake LLM_MODEL=fake bun dev
```

Playwright screenshot helpers live in `scripts/*.mjs`. Run them while `bun dev`
is up, with `CHROME_PATH=/usr/bin/google-chrome bun scripts/live.mjs <out-dir>`.

---

## Known limitations

- **"Lands N rows above the floor" is off by one.** A piece resting on the floor reads as "1 row above the floor".
- **No advanced moves.** Wall kicks, tucks under overhangs and T-spins aren't in the option list.
- **Dashed outlines after a line clear** are drawn at their pre-clear height, so they can appear to float.
- **Live latency includes your network.** Running from a different region changes the numbers.
- **One seed is one game.** Compare across several seeds before drawing conclusions.
- **Speed and survival are linked.** A faster model places more pieces per minute, so with the same placement quality its stack also rises faster. That's why the winner is decided by pieces landed, not by time survived.
- **Costs are recorded when each answer arrives.** Runs made before a model's prices were set keep $0 for that model.
- **GPT-6.1 Sol's price isn't in AWS's price list.** It comes from third-party Bedrock listings; Claude Haiku 5.5's comes from the AWS Price List API.
- **Bedrock session credentials expire.** When they do, live Bedrock boards fail with errors: refresh the `AWS_*` values in `.env` and restart.
- **Runs started through the API** (`POST /api/runs`) don't appear in a page that's already open. Watch them by replaying their log afterwards.
