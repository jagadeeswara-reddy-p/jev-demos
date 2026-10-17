# Earlier results

The first rounds, kept for reference. Current results are in the [README](../README.md#benchmarks).

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
