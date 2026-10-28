# Results history

Every published round, newest first, kept for reference. The latest results are in the [README](../README.md#latest-results).
The `bun run stats` commands below were run on our own run logs, which aren't published; the
2026-10-17 benchmark logs are, in [benchmarks/](../benchmarks/README.md).

## 2026-10-28: four models, Tetris v3

The first `bun bench` round, with equal pieces on the frozen clock. The chart and table are in the [README](../README.md#latest-results); the logs are in [benchmarks/2026-10-28](../benchmarks/README.md).

## 2026-10-17: six models, Tetris v1 and JevBench

Measured on 2026-10-17. Laya and Strands Decider ran on one NVIDIA A10G in AWS us-east-1; every other model through its provider's API. All round trips are from the same machine in India, so latency includes about 0.2–0.3 s of network.

The recording of the six-model run (seed 1, real-time clock, 6× speed) is [docs/media/demo-six-models.mp4](media/demo-six-models.mp4). Jev lands 148 pieces; Clef 106; GPT-6.1 Sol 32; Laya and Strands Decider top out within 25 seconds; Claude Opus 5.5 lands 9, too slow for the falling pieces. The results screen follows the game.

### Tetris v1: under time pressure

Six models on the same pieces, four live games (seeds 1–4, real-time clock),
each stopped once four of the six boards had topped out. The winner of a game is
the board with the most **pieces landed**: placed where the model chose, in time.
Tetris v1, 4 seeds, no intervals yet.

| Model | Type | Pieces landed per game | Games won | Best moves | Top-3 moves | Median answer | Too late | Cost (4 games) |
|---|---|---|---|---|---|---|---|---|
| **Jev** | decision model | **118.8** | **4 of 4** | 60% | 84% | **289 ms** | **0%** | $0.03 |
| Cloudflare Clef | decision model | 69.3 | 0 | 49% | 80% | 438 ms | 1% | $0.11 |
| GPT-6.1 Sol | language model | 23.3 | 0 | 72% | 95% | 2.04 s | 13% | $0.48 |
| Strands Decider 2B | decision model | 21.0 | 0 | 15% | 39% | 435 ms | 1% | self-hosted |
| Laya | decision model | 20.5 | 0 | 7% | 15% | 452 ms | 0% | self-hosted |
| Claude Opus 5.5 | language model | 9.5 | 0 | **79%** | **96%** | 5.14 s | 46% | $1.02 |

**Best moves** is the share of answers that picked the reference heuristic's
top option, counted on every answer, late or not, so it measures judgement
apart from speed. The column is called **Agreement with heuristic** in the
README from v0.1 on; the numbers are the same. The large language models choose
best but answer too slowly for the falling pieces; Laya and Strands answer fast
but choose poorly; Jev is the only model that is both fast and good. The game logs are in
[benchmarks/2026-10-17](../benchmarks/README.md); `bun run stats benchmarks/2026-10-17/tetris/*.jsonl` recomputes this table.

### JevBench: typed decisions on text

[JevBench](https://github.com/fstandhartinger/jevbench) (v1.0.0, commit `609a664`)
is an independent benchmark for decision models: 231 public questions in 18
families (yes/no, pick one, rate on a scale) about short texts, in three tiers.
It is the home ground of Laya and Strands Decider, so it shows whether a weak
Tetris score means a weak model or only a poor fit for Tetris. Each model
answered every question once, through JevBench's own adapters.

| Model | Accuracy | Easy | Original | Hard | Median time | Cost per 1,000 decisions |
|---|---|---|---|---|---|---|
| GPT-6.1 Sol | **99.6%** (230/231) | 48/48 | 72/72 | 110/111 | 1.7 s | $2.12 |
| Claude Opus 5.5 | **99.6%** (230/231) | 48/48 | 72/72 | 110/111 | 2.5 s | $10.01 |
| Cloudflare Clef | **87.9%** (203/231) | 48/48 | 71/72 | 84/111 | 393 ms | $0.17 |
| Jev | **86.1%** (199/231) | 48/48 | 71/72 | 80/111 | 297 ms | $0.04 |
| Strands Decider 2B | **77.9%** (180/231) | 48/48 | 67/72 | 65/111 | 516 ms | self-hosted |
| Laya | **53.7%** (124/231) | 47/48 | 47/72 | 30/111 | 473 ms | self-hosted |

GPT and Opus each missed one question; Jev and Clef lose most of their points on the hard tier. JevBench's own leaderboard lists Jev 1.13.0 at 96.3% on its scored 242-decision set; this table is the 231-question public set, one pass per model, run by us on 2026-10-17. Cost is per 1,000 decisions at list prices.

Given time, the language models answer almost everything correctly; the
decision models trade some accuracy for answers in a few hundred milliseconds,
which is what the falling pieces reward. Strands Decider is a solid small
decision model on text (it matches its own published 72–76%) yet poor at
Tetris; Laya stays weak on both. Why each model scores what it does, and
everything we tried, is in [findings.md](findings.md).

The 2026-10-10 demo (three models) is [docs/media/demo.mp4](media/demo.mp4); its round is below.

## Results so far

**Who wins a run:** the board with the most **pieces landed**, meaning pieces
the model put where it chose, in time. Ties go to more lines, then longer
survival. (In the optional [40-line sprint](how-it-works.md#two-goals-survive-or-sprint) the
first to 40 lines wins instead.) Every board in a run gets the same pieces,
prompts and rules. Runs stopped within the first few decisions are left out.
Regenerate any of these numbers with `bun run stats`.

Every run reports two things: **speed** (pieces landed, too late) and
**move quality** ([best moves](how-it-works.md#move-quality-best-moves): how often a model picked
the reference heuristic's top option, graded on every answer, late or not).

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

**Move quality** (every answer that named an option, including the late ones):

| Model | Graded answers | Best moves | In top 3 | Median answer time |
|---|---|---|---|---|
| **gpt-6.1-sol** | 55 | **75%** | **96%** | 4.01 s |
| Jev | 372 | 57% | 82% | 279 ms |
| claude-haiku-5-5 | 157 | 51% | 82% | 1.52 s |

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
- **GPT-6.1 Sol plays the best moves, it just can't keep up.** Its answers
  match the reference heuristic's top pick 75% of the time (Jev 57%, Haiku
  51%), and 96% of them are in the top three. Its low score in real time comes
  from answer time, not from the prompt or from bad choices. The frozen clock
  measures quality with speed taken out; GPT hasn't had a frozen run yet.
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
