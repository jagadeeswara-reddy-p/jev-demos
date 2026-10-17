# Deadline Tetris

A live benchmark for decision models and language models. Every model plays the
same Tetris game, piece for piece, with the same prompt and rules, and **the
pieces keep falling while it thinks**: an answer that arrives after the piece
has landed doesn't count. It measures speed and judgement together, then
separately.

[![Live run at 4× speed](docs/media/demo.gif)](docs/media/demo.mp4)

- [Benchmarks](#benchmarks)
- [Setup](#setup)
- [Documentation](#documentation)

---

## Benchmarks

Measured on 2026-10-17. Laya and Strands Decider ran on one NVIDIA A10G in AWS
us-east-1; every other model through its provider's API. All round trips are
from the same machine in India, so latency includes about 0.2–0.3 s of network.

### Tetris under time pressure

Six models on the same pieces, four live games (seeds 1–4, real-time clock),
each stopped once four of the six boards had topped out. The winner of a game is
the board with the most **pieces landed**: placed where the model chose, in time.

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
apart from speed. The large language models choose best but answer too slowly
for the falling pieces; Laya and Strands answer fast but choose poorly; Jev is
the only model that is both fast and good. Reproduce with `bun run stats --since 2026-10-17T14:07`.

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
everything we tried, is in [docs/findings.md](docs/findings.md).

---

## Setup

Requires [Bun](https://bun.sh) 1.4 or later. One Bun process serves the page and the API.

```sh
git clone https://github.com/jagadeeswara-reddy-p/jev-demos && cd jev-demos
bun install
cp .env.example .env     # add the keys for the models you want (below)
bun dev                  # http://localhost:5317
```

The server prints each model and whether it is ready. Open the page, press
**Models** in the top bar, tick up to six models for the line-up (press **Test**
on any of them for one real move), then **Start live run**. No keys yet? The
**Line-up** menu has mock line-ups that run entirely in the browser.

### Keys (`.env`)

| Model | Set in `.env` |
|---|---|
| Jev | `TYPESAFE_API_KEY` |
| Cloudflare Clef | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (Workers AI permission) |
| GPT-6.1 Sol, Claude Opus 5.5, Claude Haiku 5.5 (AWS Bedrock) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` or `AWS_PROFILE`; `AWS_REGION` (default `us-east-1`) |
| Any OpenAI-compatible chat model | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, or add it in the Models panel |
| Laya, Strands Decider | `LAYA_BASE_URL`, `STRANDS_BASE_URL`; `deploy/ec2/launch.sh` sets them (below) |

Restart `bun dev` after editing `.env`. Keys stay on the server; the page never
receives them. The server listens on `127.0.0.1` unless `HOST` is set.

### Adding a model

In the page: **Models** → **Add model**. Choose the adapter by the API the model speaks:

- **Completion**: an OpenAI-compatible Chat Completions API (OpenAI, OpenRouter, Groq, vLLM, Ollama, gateways).
- **Decision**: the Decisions API, `POST /v1/systemone` (Jev, Laya, Clef, Strands Decider).

Give a name, the API address, the model name and a key; saving runs one test
move. Models added this way are saved in `models.local.json` (git-ignored).
Built-in models live in `models.json`. Every setting is in [docs/models.md](docs/models.md).

### Self-hosted models (Laya and Strands Decider)

```sh
deploy/ec2/launch.sh        # g5.xlarge (A10G, about $1/hour); deletes itself after 1 hour
deploy/ec2/wait-ready.sh    # waits until both answer real moves (about 4 minutes)
bun dev                     # restart so the page uses the new address
deploy/ec2/teardown.sh      # when you're done
```

Needs AWS credentials in `.env`. Details, costs and debugging: [docs/self-hosting.md](docs/self-hosting.md).

### Checks

```sh
bun run lint && bun run typecheck && bun test
bun run smoke               # one real move from every model that can run
```

---

## Documentation

| | |
|---|---|
| [docs/findings.md](docs/findings.md) | What we found: why each model scores what it does, position bias, deploy lessons |
| [docs/how-it-works.md](docs/how-it-works.md) | The game, the clocks and goals, what every model is shown, how answers are judged, the screens |
| [docs/models.md](docs/models.md) | Model settings, the adapters and their wire formats, writing a new adapter |
| [docs/configuration.md](docs/configuration.md) | Built-in models, every `.env` setting, prices |
| [docs/self-hosting.md](docs/self-hosting.md) | Running Laya and Strands Decider on a GPU |
| [docs/api.md](docs/api.md) | The server API and the run log format |
| [docs/development.md](docs/development.md) | Project layout, tests and tools, known limitations |
| [docs/results-history.md](docs/results-history.md) | Earlier rounds (2026-10-09 and 2026-10-10) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
