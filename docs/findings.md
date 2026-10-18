# Findings: six models, two benchmarks, and why the open decision models fall behind

What we measured between 2026-10-12 and 2026-10-17, what we tried, and what we
concluded. The short version: **nothing in our setup holds Laya or Strands
Decider back.** Both get the same request as every other model, and every knob
their own documentation offers was tried. Laya cannot tell options apart by the
numbers in them, and so falls back on where an option is listed. Strands Decider
is a capable small model on text decisions but too unsure to play Tetris. Jev
is the only model that is both fast and good at the game.

## Contents

1. [Models and set-up](#models-and-set-up)
2. [Results](#results)
3. [How we tested](#how-we-tested)
4. [Laya](#laya)
5. [Strands Decider](#strands-decider)
6. [Jev and Cloudflare Clef](#jev-and-cloudflare-clef)
7. [The language models](#the-language-models)
8. [Could we host Clef ourselves?](#could-we-host-clef-ourselves)
9. [Deployment lessons](#deployment-lessons)
10. [Costs](#costs)
11. [Limits of these results, and next steps](#limits-of-these-results-and-next-steps)
12. [Sources](#sources)

## Models and set-up

| Model | Kind | Size | Where it ran | How the arena calls it |
|---|---|---|---|---|
| Jev (`jev-latest`, reports `jev-1.13.0`) | decision model | undisclosed | TypeSafe API | Decision adapter, `/v1/systemone` |
| Cloudflare Clef | decision model | 27B (Qwen3.8-27B) | Workers AI | Decision adapter, Cloudflare's URL |
| Strands Decider 2B (`strands-decider-2B-qwen3.5-v1-2610`) | decision model | 1.9B (Qwen3.5-2B) | our A10G, `strands-decider serve` at commit `b9fc836` | Decision adapter |
| Laya (`typed-decisions`) | decision model | 421M (ModernBERT-large) | our A10G, `laya-serve` 0.4.8, fp16 | Decision adapter, 4 rotations, larger token budget |
| GPT-6.1 Sol | language model | undisclosed | AWS Bedrock | Bedrock adapter (forced answer tool) |
| Claude Opus 5.5 | language model | undisclosed | AWS Bedrock | Bedrock adapter (answer tool offered, not forced) |

Every model gets the same board text and the same option descriptions, word for
word. A decision model gets them as one `choice` question; a language model as a
user message and asked for `{"choice": "option_N"}`. Each option carries its
consequences, computed by the game: columns, lines cleared, holes created, stack
height and bumpiness after. A piece has up to 34 legal landing spots.

## Results

### Tetris, live (2026-10-17, seeds 1–4, real-time clock, 4 games)

| Model | Pieces landed per game | Games won | Best moves | Top-3 moves | Median answer | Too late |
|---|---|---|---|---|---|---|
| Jev | **118.8** | **4 of 4** | 60% | 84% | **289 ms** | **0%** |
| Cloudflare Clef | 69.3 | 0 | 49% | 80% | 438 ms | 1% |
| GPT-6.1 Sol | 23.3 | 0 | 72% | 95% | 2.04 s | 13% |
| Strands Decider 2B | 21.0 | 0 | 15% | 39% | 435 ms | 1% |
| Laya | 20.5 | 0 | 7% | 15% | 452 ms | 0% |
| Claude Opus 5.5 | 9.5 | 0 | **79%** | **96%** | 5.14 s | 46% |

"Best moves" grades every answer against the reference heuristic's top option,
late or not, so it measures judgement apart from speed.

### JevBench (2026-10-17, 231 public questions, one pass each)

| Model | Accuracy | Easy | Original | Hard | Median time | Cost per 1,000 decisions |
|---|---|---|---|---|---|---|
| GPT-6.1 Sol | **99.6%** (230/231) | 48/48 | 72/72 | 110/111 | 1.7 s | $2.12 |
| Claude Opus 5.5 | **99.6%** (230/231) | 48/48 | 72/72 | 110/111 | 2.5 s | $10.01 |
| Cloudflare Clef | **87.9%** (203/231) | 48/48 | 71/72 | 84/111 | 393 ms | $0.17 |
| Jev | **86.1%** (199/231) | 48/48 | 71/72 | 80/111 | 297 ms | $0.04 |
| Strands Decider 2B | **77.9%** (180/231) | 48/48 | 67/72 | 65/111 | 516 ms | self-hosted |
| Laya | **53.7%** (124/231) | 47/48 | 47/72 | 30/111 | 473 ms | self-hosted |

GPT and Opus each missed one question; Jev and Clef lose most of their points on the hard tier. JevBench's own leaderboard lists Jev 1.13.0 at 96.3% on its scored 242-decision set; this table is the 231-question public set, one pass per model, run by us on 2026-10-17. Cost is per 1,000 decisions at list prices.

### Shuffle test (12 boards × 6 option orders, frozen clock)

| Model | First two options picked (chance ≈ 7%) | Same pick across orders | Best move | Median |
|---|---|---|---|---|
| Cloudflare Clef | 10% | **100%** | **75%** | 435 ms |
| Jev | 4% | 86% | 53% | **285 ms** |
| Strands Decider 2B | **1%** | 57% | 28% | 480 ms |
| Laya, 4 rotations | 22% | 39% | 10% | 669 ms |
| Laya, 12 rotations | 19% | 42% | 10% | 1,088 ms |
| Laya, no rotations | 42% | 31% | 4% | 512 ms |

## How we tested

- **Live games.** Six boards, same pieces, real-time clock: a piece that locks
  before the answer arrives drops where gravity takes it. Logged event by event
  in `runs/`; summarised with `bun run stats`.
- **Shuffle test** (`scripts/position-bias.ts`). Twelve boards from a seeded
  game, each asked six times with the options in a different order. A model that
  reads the options picks the same spot every time; one that leans on position
  follows the order. Measures position bias, consistency and move quality
  without the clock.
- **Two-option test.** One obviously good option ("clears 1 line, creates no
  holes, stack height 2") against one obviously bad ("clears no lines, creates 3
  holes, stack height 7"), in both orders, worded with numbers and in plain words.
- **Wording, budget and instruction variants.** Same boards, options reordered
  so the decisive facts come first, reduced to bare numbers, or with an explicit
  priority order in the instructions.
- **JevBench.** The public set run through JevBench's own adapters: the
  `typesafe` adapter for the decision models (direct for Jev, Laya and Strands; via
  a small local shim for Clef's URL), the `openai_compat` adapter through a shim
  to Bedrock for GPT and Opus.

## Laya

**Verdict: Laya cannot rank options by the numbers in them, so its preference for
early options decides. It is not a configuration problem.**

| What we checked | Result |
|---|---|
| Right checkpoint loaded? | Yes: `typed-decisions` on CUDA (`/health`). The response's `laya-rl-agent` is the family tag every Laya model reports. |
| Options cut off? | Not with our budget (`max_len` 4096, `head_max_len` 2048): 1,565 input tokens, nothing dropped. **At Laya's defaults each of 34 options would get about 7 tokens** ("Rotation 1, columns 1-2"), with the holes and lines cut, while the response still says `truncated: false`. Raising the budget was necessary. |
| Position bias | Picks one of the first two options 42% of the time, against about 7% by chance; changes its answer when only the order changes (31% same pick). Laya's README measures the same effect on identical options. |
| Rotations (Laya's own fix, `option_order`) | 4 rotations halve the bias (22%) and lift best moves from 4% to 10%; 12 add little and double the latency. Kept at 4. |
| Facts first, as its docs advise | Best moves 3% (current wording 8%, numbers only 8%). No gain. |
| Tournament mode (`LAYA_TOURNAMENT_GROUP=16`, its docs' answer to many options) | Worse: 0% best moves, 50% first-two picks. It also does not combine with rotations: a question with `option_order` keeps the one-pass path. |
| Two-option test | With numbers it **follows position**: probability of the good option 0.67 when listed first, 0.34 when second. In plain words it gets both right, weakly (0.58, 0.65). Strands (0.76–0.92) and Jev (0.98–1.00) pass every case. |
| JevBench | 53.7% overall; 47/48 easy, 47/72 original, 30/111 hard. |

**Why.** The `typed-decisions` checkpoint is a 421M encoder fine-tuned on four
business workflows (customer service, invoices, security incidents, agent
traces), 1,024-token inputs, a 256-token option budget. Its own documentation
says accuracy "degrades quickly" past about 20 options and that the checkpoints
were trained at their shipped head length. Reviewers report the base model near
chance zero-shot (about 0.36 against a 0.32 baseline) and 0.425 on a 77-label
task where Jev scores 0.870. A Tetris turn is 34 near-identical sentences that
differ only in their numbers, which is what it cannot read.

**What would help.** Fine-tuning on Tetris decisions with Laya's own notebook.
That would make it a different model, so the benchmark keeps the published
checkpoint, with rotations, as its fairest setting.

## Strands Decider

**Verdict: a solid small decision model on text, too unsure to play Tetris.**

- **On JevBench it is strong for its size:** 77.9%, all 48 easy questions, 67 of
  72 original, 65 of 111 hard, in line with its own published 72–76%.
- **In Tetris it topped out after 15–25 seconds in every game.** Every answer was
  on time; the moves were the problem. In one game it stacked columns 3–5 and
  created holes (5 on one move, 4 on another). Its confidence was 5–17% on almost
  every move, barely above the 3% of a random pick among 34.

| What we checked | Result |
|---|---|
| Too many options (`num_slots: 24` in `/health`) | No. This checkpoint has a pointer head that scores each option from its text, so there is no cap; best moves 25% with up to 24 options and 25% above. |
| Position bias | None: 1–3% first-two picks. Its server ignores `option_order`, so rotations would only repeat the question. |
| Wording | Facts first 33%, current 25%, numbers only 22%: within the noise of 36 answers. |
| Explicit priorities in the instructions ("fewest holes first, then lines, then height") | Worse: 17%. |
| Can it read the options at all? | Yes: the two-option test 4 of 4, probability of the good option 0.76–0.92. |

**Why.** It is a 2B one-pass model. Its makers say the design is "significantly
worse at solving complex problems" than reasoning models, and reviewers call it
"a useful small model but not a strong one", best for simple classification
retrained on your own labels. Choosing among 34 options that differ in four
numbers each is a harder judgement than routing a ticket, and its low confidence
shows it.

## Jev and Cloudflare Clef

- **Jev wins on average.** Over the four games of 2026-10-17 it landed 118.8
  pieces per game against Clef's 69.3, at 289 ms median, never late. Across all
  six-board games on seed 1: Jev 123, 98, 123, 95; Clef 85, 78, 78, 106.
- **A single game can swing by ±25 pieces.** Jev's answers vary slightly between
  calls; on the fifth piece of seed 1 two spots are almost tied (0.25 against
  0.24–0.28). Whichever it picks, the boards differ from then on. The 123-piece
  games picked option_17; the 95- and 98-piece games picked option_11, the
  heuristic's own top choice. Nothing in the code, prompt or request changed
  between those games. Compare averages over several games and seeds, never one game.
- **Clef has the best judgement of the fast models**: 100% consistent in the
  shuffle test, 75% best moves there, 87.9% on JevBench. It is about 150 ms
  slower than Jev per move, which costs it pieces under the real-time clock.

## The language models

GPT-6.1 Sol and Claude Opus 5.5 choose best (72% and 79% best moves, 95–96% in
the top three; 99.6% each on JevBench) but answer in 2–5 seconds, so under
the real-time clock 13% and 46% of their answers arrive after the piece has
landed. With the clock frozen they would rank first; under time pressure they
rank last but one and last.

## Could we host Clef ourselves?

Yes: the weights are on Hugging Face under Apache 2.0, and Cloudflare's SGLang
image (`lmsysorg/sglang:dev-clef`) serves `/v1/systemone`, so it would plug into
the Decision adapter unchanged. Clef (27B) is about 54 GB in bf16, too large for
the A10G; it needs an 80 GB GPU, or an 8-bit build on a 48 GB L40S. Clef-flash
(9B, about 18 GB) fits a 24–48 GB GPU. On Workers AI a whole game costs about
$0.13, so self-hosting only pays for privacy or for measuring Clef without the
network round trip.

## Deployment lessons

| What happened | Fix now in `deploy/ec2/` |
|---|---|
| `pip install strands-decider` installed 0.1.0 from PyPI, older than the repository; the server never started | Strands pinned to a known-good commit; Laya pinned to 0.4.8, which matches its repository |
| Laya's Docker image built for 12 minutes on every launch | Laya installed from PyPI into its own virtualenv, alongside Strands: both ready in about 4 minutes |
| Strands' first moves took 30–60 s while Triton compiled its kernels, longer than the arena's timeout | `wait-ready.sh` sends real warm-up moves before calling a model ready |
| A health check passing did not mean a model could answer; a failure went unnoticed for 20 minutes | `wait-ready.sh` waits for real answers and prints errors from the boot log as they appear |
| No way to log in to a failing box | Throwaway SSH key and port 22 for the current IP only; teardown removes them |
| Strands needs bf16 and Triton kernels, which the T4 lacks | g5.xlarge (A10G, $1.006/hour) by default; the T4 only for Laya alone |
| The firewall kept a previous IP's access after the address changed | Every launch clears old rules |
| Laya could silently fall back to the CPU | `LAYA_DEVICE=cuda`, so it fails loudly |
| Temporary AWS credentials expired between sessions | `launch.sh` checks them first |

## Costs

The whole investigation, 9–17 October, cost about $14 in model calls and GPU time
(list prices; the AWS part was covered by credits):

| Item | Cost |
|---|---|
| Claude Opus 5.5 (Bedrock) | $7.12 |
| GPT-6.1 Sol (Bedrock) | $2.57 |
| Cloudflare Clef | about $0.45 |
| Jev | about $0.21 |
| Claude Haiku 5.5 (Bedrock) | $0.04 |
| GPU boxes (T4 1.4 h, A10G 2.9 h, with disks) | about $3.75 |
| **Total** | **about $14** |

Opus is half of it: the most expensive per token and the most tokens per move.
The four benchmark games cost $1.64 in model calls and the JevBench pass $2.85.

## Limits of these results, and next steps

- Four games is a small sample; the Tetris table should be read as a ranking,
  not exact numbers. JevBench is one pass per model.
- Latency includes the network from India to us-east-1 (about 0.2–0.3 s round trip).
- JevBench is designed around Jev's API; it is independent and MIT-licensed, but
  Jev-class models are its natural audience.
- Next: more seeds for the Tetris table; a frozen-clock round, where the
  language models should lead; and a fine-tuned Laya, measured as a separate model.

## Sources

- Laya: [repository and docs](https://github.com/NandhaKishorM/laya) (`docs/benchmarks.md`, `docs/http-api.md`, issue [#171](https://github.com/NandhaKishorM/laya/issues/171)); [AI Weekly](https://aiweekly.co/alerts/convai-ships-laya-a-421m-modernbert-decision-model-apache-20); [eesel review](https://www.eesel.ai/blog/laya-ai-review); [innfactory](https://innfactory.ai/en/ai-models/laya/); [Layer3 Labs](https://www.layer3labs.io/guides/laya-benchmarks)
- Strands Decider: [repository](https://github.com/strands-labs/strands-decider) (`docs/inference.md`, `evaluation/jevbench.md`); [eesel review](https://www.eesel.ai/blog/strands-decider); [Beri](https://www.beri.net/article/cloudflare-clef-amazon-strands-decider-open-weight-decision-models-vs-jev-benchmarks-pricing); [Pasquale Pillitteri](https://pasqualepillitteri.it/en/news/19998/aws-strands-decider-2b-jev)
- Clef: [Cloudflare/clef](https://huggingface.co/Cloudflare/clef) and [Cloudflare/clef-flash](https://huggingface.co/Cloudflare/clef-flash) on Hugging Face
- JevBench: [repository](https://github.com/fstandhartinger/jevbench)
- Jev: [MetricNexus](https://metricnexus.ai/blog/jev-benchmarks-pricing)
