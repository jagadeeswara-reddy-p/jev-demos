# How it works

The game, what every model is shown, how answers are judged, and what the screens mean.

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

### Two goals: survive or sprint

The **Goal** setting picks what a run is about. It's recorded in the run's
config, so replays and `bun run stats` use the same rules.

| | **Survive** (default) | **40 lines** (sprint) |
|---|---|---|
| A board stops when | it tops out (or places 1,000 pieces) | it tops out, or **clears 40 lines** (shown as FINISHED) |
| Winner, real time | most pieces landed, then lines, then time survived | **first to 40 lines**; boards that fell short rank by lines, then pieces landed |
| Winner, frozen clock | same as real time | **fewest pieces to 40 lines**, since time there mostly measures waiting |

The rules live in one place, `src/arena/ranking.ts`, shared by the results
chart and the stats script.

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

| | Decision adapter (`server/adapters/decision.ts`) | Completion adapter (`server/adapters/completion.ts`) |
|---|---|---|
| Request | `POST {baseUrl}/v1/systemone` | `POST {baseUrl}/chat/completions` |
| Board text | the `state` field | the user message |
| Options | a `choice` question with one entry per option (`option_N` → description) | listed as `option_N: description` lines after the board |
| Answer | `choice`, a probability for every option, and a `confidence` | strict JSON `{"choice":"option_N"}`; the schema only allows the offered ids |

Every decision model gets byte-for-byte the same question. Two kinds of
per-model setting change how it is sent, never what it says:

- **Extra request fields.** Laya's default token budget for the option list is
  192–256 tokens and the full list is about 1,100, so its entry in `models.json`
  raises `max_len` and `head_max_len`. If a request still doesn't fit, the
  server says so and the Test button shows it.
- **Option-order rotations.** Some decision models prefer options listed early
  ([Laya documents this](https://github.com/NandhaKishorM/laya#option-order)).
  With `rotations: N` the same question is asked N times in one request, each
  copy with the options shifted (`option_order`), and the probabilities are
  averaged. The model must accept `option_order`: laya-serve does; Cloudflare
  Clef rejects it; Strands Decider ignores it.

**AWS Bedrock models** (`server/adapters/bedrock.ts`) get the same system and
user text as the completion adapter. They go through Bedrock's Converse API,
which uses one request shape for every provider, and answer with a forced
`choose_option` tool call whose `choice` is limited to the offered ids.
Bedrock caches OpenAI prompts automatically and reports cache reads and writes
separately, so those are counted as input tokens to keep the token columns comparable.

**Latency** is measured on the server's clock, from just before the request to
just after the response is read, so it **includes the network round trip**, as
a real game loop would experience it.

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

### Move quality (best moves)

Speed alone can't tell a slow model with good judgement from a bad one, so every
answer is also graded. When a piece appears, the game scores every offered
option with the **reference heuristic**. That's the classic hand-written
Dellacherie evaluator, the same one the mock players use, in
`src/engine/heuristic.ts`. Options that tie share a rank. The answer's rank is
stored on its `decision` event as `bestRank` (1 = the heuristic's top pick).

- **Best moves** = share of graded answers with rank 1. **In top 3** (stats only) = rank 3 or better.
- **Late answers are graded too**, against the piece they were asked about. This measures judgement apart from speed.
- Invalid answers, errors and timeouts aren't graded.
- The heuristic is a yardstick, not the truth. It looks at one piece and ignores the next ones, so a model planning ahead can lose a point here for a move that's actually better. Treat a gap of a few points as noise.
- `bun run stats` grades older logs (from before `bestRank` existed) the same way, from the logged board and options.

## Reading the screen

The page has three screens, and each fits one window without scrolling.

**Setup and fight** share one layout:
- **Top bar.** Before a run it holds the settings: Line-up (the live models, or
  a mock line-up), Clock (Real time or Frozen), Goal (Survive or 40 lines) and
  Seed (the dice picks a random one). Then come icon buttons for Results,
  Replay, Export log, Load log, **Models** (pick the line-up, test and add
  models) and Theme, and **Start**. During a run the bar shows the level, how
  fast pieces fall, game time, clock, goal and seed, plus Pause and Stop. Space
  pauses or resumes a mock run or replay. Adding `?speed=4` to the address
  fast-forwards mock runs and replays.
- **Standings strip**: one slot per model, sliding into rank order as the run goes.
- **Boards**, in up to two rows of three. Each card has:
  - **The board**. In the gutter are the next 3 pieces, plus labels with arrows pointing at:
    - **solid outline + "OPT N, xx% chosen"**: where the model put the last piece;
    - **dashed outlines + "OPT N, xx%"**: the two strongest alternatives the model considered.
  - **Deadline bar**: time spent thinking against the time left before the piece locks. Hatched means the deadline passed.
  - **Stats**:
    - **Landed X of Y**: pieces placed where the model chose, in time, out of all that locked.
    - **Lines.**
    - **Best moves**: see [move quality](#move-quality-best-moves).
    - **Decision p50 / p95**: median and 95th-percentile answer time.
    - **Too late**, **Bad answers** and **Cost**.

**Results** appears when a run ends. Its header names the winner by the run's
win rule. Below it:
- the game replayed as a race;
- pieces landed (or lines) over game time;
- **smart versus fast**: best moves against time per decision;
- time per decision (median and p95);
- a table with every number.

**Are the outlines real?**
- **Live Jev**: yes. The chosen spot is Jev's `choice`, and the dashed outlines and percentages are Jev's own probabilities from the API (top 2 alternatives at 1% or more).
- **Live language model**: the chosen spot is real. There are **no dashed alternatives**, because a chat model returns only a choice, without probabilities.
- **Mock models**: simulated. A pretend model picks randomly, weighted toward the hand-written bot's favourite spots.
- **The option list itself is always real**: OPT numbers are the `option_N` ids both models were sent.

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
