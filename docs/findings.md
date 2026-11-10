# Findings: why each model scores the way it does

What we measured between 9 and 17 October 2026, what we tried, and what we
concluded. The headline results are in the [README](../README.md#results); this
page explains them.

## In short

- **Jev is the only model that is both fast and accurate.** It answers in about 0.3 s, is never late, and places the most pieces.
- **Cloudflare Clef chooses well, but is about 150 ms slower than Jev**, which costs it pieces in Live games.
- **The language models choose best, but answer in 2–5 s**, so many pieces land before they answer. When the game waits for them, they lead.
- **Strands Decider is a capable small model on text, but too unsure to play Tetris.**
- **Laya can't tell options apart by the numbers in them**, so it falls back on picking options near the top of the list.
- **Nothing in our setup holds Laya or Strands Decider back.** Both get the same request as every other model, and we tried every setting their own documentation offers.

## Contents

1. [The models](#the-models)
2. [How we tested](#how-we-tested)
3. [Jev](#jev)
4. [Cloudflare Clef](#cloudflare-clef)
5. [The language models](#the-language-models)
6. [Strands Decider](#strands-decider)
7. [Laya](#laya)
8. [Costs](#costs)
9. [Limits of these results](#limits-of-these-results)
10. [Sources](#sources)

## The models

| Model | Kind | Size | Where it ran |
|---|---|---|---|
| Jev (`jev-latest`, reports `jev-1.13.0`) | decision model | undisclosed | TypeSafe API |
| Cloudflare Clef | decision model | 27B (Qwen3.8-27B) | Workers AI |
| Strands Decider 2B (`strands-decider-2B-qwen3.5-v1-2610`) | decision model | 1.9B (Qwen3.5-2B) | our A10G GPU, `strands-decider serve` at commit `b9fc836` |
| Laya (`typed-decisions`) | decision model | 421M (ModernBERT-large) | our A10G GPU, `laya-serve` 0.4.8, fp16 |
| GPT-6.1 Sol | language model | undisclosed | AWS Bedrock |
| Claude Opus 5.5 | language model | undisclosed | AWS Bedrock |

Every model gets the same board and the same option descriptions, word for word.
Each option lists what it would do to the board: the columns it covers, lines
cleared, holes created, and the stack's height and bumpiness afterwards. A piece
has up to 34 places it can land.

## How we tested

- **Live games.** Four games (games 1–4), six boards, the same pieces. The numbers are in the [README](../README.md#results).
- **JevBench.** An independent benchmark of 231 public text questions for decision models ([results](#jevbench-results)). It shows whether a weak Tetris score means a weak model, or only a poor fit for Tetris.
- **Shuffle test** (`scripts/position-bias.ts`). Twelve boards, each asked six times with the options in a different order, with the game paused. A model that reads the options picks the same spot every time; one that leans on position follows the order.
- **Two-option test.** One clearly good option against one clearly bad one, in both orders, worded with numbers and in plain words.
- **Wording variants.** The same boards with the key facts first, as bare numbers, or with an explicit priority order in the instructions.

### JevBench results

| Model | Accuracy | Easy | Original | Hard | Median time | Cost per 1,000 decisions |
|---|---|---|---|---|---|---|
| GPT-6.1 Sol | **99.6%** | 48/48 | 72/72 | 110/111 | 1.7 s | $2.12 |
| Claude Opus 5.5 | **99.6%** | 48/48 | 72/72 | 110/111 | 2.5 s | $10.01 |
| Cloudflare Clef | 87.9% | 48/48 | 71/72 | 84/111 | 393 ms | $0.17 |
| Jev | 86.1% | 48/48 | 71/72 | 80/111 | 297 ms | $0.04 |
| Strands Decider 2B | 77.9% | 48/48 | 67/72 | 65/111 | 516 ms | self-hosted |
| Laya | 53.7% | 47/48 | 47/72 | 30/111 | 473 ms | self-hosted |

One pass per model, run by us on 2026-10-17 through JevBench's own adapters. JevBench's own leaderboard lists Jev 1.13.0 at 96.3%, on a different (scored, 242-question) set.

### Shuffle test results

| Model | Picked one of the first two options (chance ≈ 7%) | Same pick in every order | Good-move rate |
|---|---|---|---|
| Cloudflare Clef | 10% | **100%** | **75%** |
| Jev | 4% | 86% | 53% |
| Strands Decider 2B | **1%** | 57% | 28% |
| Laya, 4 rotations | 22% | 39% | 10% |
| Laya, no rotations | 42% | 31% | 4% |

## Jev

**Verdict: fast and accurate. It won all four games.**

- **Tetris:** 118.8 pieces placed per game, 289 ms typical answer, never late. Good-move rate 59%.
- **JevBench:** 86.1%. It loses most of its points on the hard questions.
- **Shuffle test:** almost no position bias (4%), and the same pick in 86% of orders.

**One game proves little.** Jev's answers vary slightly between calls. On the
fifth piece of game 1, two spots score almost the same, and whichever Jev picks,
the boards differ from then on. In four other six-board runs of game 1, besides
the published one, it placed 123, 98, 123 and 95 pieces, with nothing changed
between runs. Always compare averages
over several games.

## Cloudflare Clef

**Verdict: the best judgement of the fast models, but a little slower than Jev.**

- **Tetris:** 69.3 pieces placed per game, 438 ms typical answer, fewer than 1% late. Good-move rate 48%.
- **JevBench:** 87.9%, the best of the decision models.
- **Shuffle test:** the same pick in every order (100%), and a 75% good-move rate, the highest of any model there.

**Why it places fewer pieces than Jev.** About 150 ms more per answer. As the
game speeds up, that leaves less margin before each piece lands.

**Could we host it ourselves?** Yes. The weights are on Hugging Face under Apache
2.0, and Cloudflare's SGLang image (`lmsysorg/sglang:dev-clef`) serves the same
API, so it would plug in unchanged. At 27B it needs about 54 GB, more than our
A10G: an 80 GB GPU, or an 8-bit build on a 48 GB L40S. Clef-flash (9B, about 18 GB)
fits a 24–48 GB GPU. On Workers AI a whole game costs about $0.03, so
self-hosting only pays off for privacy, or to measure Clef without the network.

## The language models

**Verdict: the best choices, but too slow for falling pieces.**

- **Tetris:** GPT-6.1 Sol placed 23.3 pieces per game with a 2.04 s typical
  answer (13% late); Claude Opus 5.5 placed 9.5 with 5.14 s (46% late).
- **Good-move rate:** 72% and 79%, the highest of all six.
- **JevBench:** 99.6% each.

**With the game paused** (the 2026-10-28 round), every answer counts, and they
lead: Opus 78% and GPT 69% good moves, against Jev's 50%
([results history](results-history.md#2026-10-28-paused-and-live-four-models)).

## Strands Decider

**Verdict: a solid small model on text, but too unsure to play Tetris.**

- **Tetris:** 21.0 pieces placed per game. Almost every answer was on time (1% late), but its boards filled up within 15–25 seconds. Good-move rate 15%.
- **JevBench:** 77.9%, in line with its own published 72–76%.
- **Confidence:** 5–17% on almost every move, barely above the 3% of a random pick among 34.

| What we checked | Result |
|---|---|
| Too many options? | No. It scores each option from its text, so there is no limit: 25% good moves with up to 24 options, and 25% above. |
| Position bias? | None (1–3%). Its server ignores option rotations, so they would not help. |
| Different wording? | 22–33% good moves across wordings: within the noise. |
| Explicit priorities ("fewest holes first, then lines, then height")? | Worse: 17%. |
| Can it read the options at all? | Yes: it passed all four two-option tests. |

**Why.** It is a 2B model that answers in one pass. Its makers say this design is
"significantly worse at solving complex problems" than reasoning models. Choosing
among 34 options that differ only in a few numbers is harder than the simple
classification it is built for.

## Laya

**Verdict: it can't rank options by the numbers in them, so the order of the list decides. It is not a setup problem.**

- **Tetris:** 20.5 pieces placed per game, never late, but its boards filled up early. Good-move rate 7%.
- **JevBench:** 53.7%, the lowest of the six.
- **Shuffle test:** picks one of the first two options 42% of the time (chance is about 7%), and changes its answer when only the order changes.

| What we checked | Result |
|---|---|
| Right model loaded? | Yes: `typed-decisions`, on the GPU. |
| Options cut off? | Not with our settings (`max_len` 4096, `head_max_len` 2048). **At Laya's default settings, each option would be cut to about 7 tokens**, dropping the holes and lines, without any warning. We raised them. |
| Rotations (Laya's own fix) | 4 rotations halve the position bias (22%) and lift good moves from 4% to 10%. 12 add little and double the time. We use 4. |
| Key facts first, as its docs advise | No gain (3%). |
| Tournament mode, its docs' answer to many options | Worse: 0% good moves. |
| Two-option test | With numbers, it follows position: it prefers whichever option comes first. In plain words it gets both right, weakly. |

**Why.** This checkpoint is a small encoder trained on four business workflows,
with short inputs. Its own documentation says accuracy "degrades quickly" past
about 20 options. A Tetris turn is 34 near-identical sentences that differ only
in their numbers, which is exactly what it can't read.

**What would help.** Fine-tuning it on Tetris decisions, with Laya's own notebook.
That would make it a different model, so the benchmark keeps the published
checkpoint, with rotations, as its fairest setting.

## Costs

The whole investigation, 9–17 October, cost about $14 at list prices (the AWS part was covered by credits):

| Item | Cost |
|---|---|
| Claude Opus 5.5 (Bedrock) | $7.12 |
| GPT-6.1 Sol (Bedrock) | $2.57 |
| Cloudflare Clef | about $0.45 |
| Jev | about $0.21 |
| Claude Haiku 5.5 (Bedrock) | $0.04 |
| GPU boxes (T4 1.4 h, A10G 2.9 h, with disks) | about $3.75 |
| **Total** | **about $14** |

Opus is half of it: the highest price per token, and the most tokens per move.
The four benchmark games cost $1.64 in model calls, and the JevBench pass $2.85.

What we learned deploying Laya and Strands Decider is in [self-hosting](self-hosting.md#lessons-from-deploying).

## Limits of these results

- Four games is a small sample. Read the Tetris results as a ranking, not exact numbers. JevBench is one pass per model.
- Answer times include the network from India to the US (about 0.2–0.3 s).
- JevBench is independent and MIT-licensed, but it is designed around Jev's API, so Jev-class models are its natural audience.
- Next: one fresh round with every model in both modes, more games for error bars, and a fine-tuned Laya measured as a separate model.

## Sources

- Laya: [repository and docs](https://github.com/NandhaKishorM/laya) (`docs/benchmarks.md`, `docs/http-api.md`, issue [#171](https://github.com/NandhaKishorM/laya/issues/171)); [AI Weekly](https://aiweekly.co/alerts/convai-ships-laya-a-421m-modernbert-decision-model-apache-20); [eesel review](https://www.eesel.ai/blog/laya-ai-review); [innfactory](https://innfactory.ai/en/ai-models/laya/); [Layer3 Labs](https://www.layer3labs.io/guides/laya-benchmarks)
- Strands Decider: [repository](https://github.com/strands-labs/strands-decider) (`docs/inference.md`, `evaluation/jevbench.md`); [eesel review](https://www.eesel.ai/blog/strands-decider); [Beri](https://www.beri.net/article/cloudflare-clef-amazon-strands-decider-open-weight-decision-models-vs-jev-benchmarks-pricing); [Pasquale Pillitteri](https://pasqualepillitteri.it/en/news/19998/aws-strands-decider-2b-jev)
- Clef: [Cloudflare/clef](https://huggingface.co/Cloudflare/clef) and [Cloudflare/clef-flash](https://huggingface.co/Cloudflare/clef-flash) on Hugging Face
- JevBench: [repository](https://github.com/fstandhartinger/jevbench)
- Jev: [MetricNexus](https://metricnexus.ai/blog/jev-benchmarks-pricing)
