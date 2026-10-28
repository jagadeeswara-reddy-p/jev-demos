# decision-bench

[![CI](https://github.com/jagadeeswara-reddy-p/jev-demos/actions/workflows/ci.yml/badge.svg)](https://github.com/jagadeeswara-reddy-p/jev-demos/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Benchmark models on judgement and speed, separately, by making them play real-time games. 2D reasoning (a board-only variant) is coming.

The first environment is *Deadline Tetris*, where pieces keep falling while the model thinks.

[![Six models playing Deadline Tetris at 6× speed](docs/media/demo-six-models.gif)](docs/media/demo-six-models.mp4)

*Seed 1, real-time clock, 6× speed. Click for the full recording.*

## Latest results

Deadline Tetris v1, 4 seeds, no intervals yet. Six models, four live games on a real-time clock, 2026-10-17.

| Model | Type | Pieces landed | Agreement with heuristic | Median answer | Too late | Cost |
|---|---|---|---|---|---|---|
| Jev | decision model | 118.8 | 60% | 289 ms | 0% | $0.03 |
| Cloudflare Clef | decision model | 69.3 | 49% | 438 ms | 1% | $0.11 |
| GPT-6.1 Sol | language model | 23.3 | 72% | 2.04 s | 13% | $0.48 |
| Strands Decider 2B | decision model | 21.0 | 15% | 435 ms | 1% | self-hosted |
| Laya | decision model | 20.5 | 7% | 452 ms | 0% | self-hosted |
| Claude Opus 5.5 | language model | 9.5 | 79% | 5.14 s | 46% | $1.02 |

Pieces landed: average per game. Cost: all four games.

**Agreement with heuristic** is the share of answers that picked the reference heuristic's top option. It counts every answer, late or not, so it measures judgement apart from speed ([how it works](docs/how-it-works.md#move-quality-best-moves)).

The language models agree with the heuristic more often but answer more slowly, so more of their answers arrive after the piece has landed.

More detail in [results history](docs/results-history.md) and [findings](docs/findings.md). The raw logs are in [benchmarks/](benchmarks/README.md), and `bun run stats benchmarks/2026-10-17/tetris/*.jsonl` recomputes this table.

## Quick start (no keys)

Needs [Bun](https://bun.sh) 1.4 or later.

```sh
git clone https://github.com/jagadeeswara-reddy-p/jev-demos && cd jev-demos
bun install
bun bench demo      # six mock models, no API calls; finishes in about a second
```

## Benchmark your models

```sh
bun bench init      # writes bench.yaml and .env from the examples
bun bench doctor    # checks each model and its key
bun bench run       # plays the bench and writes the logs
```

Edit `bench.yaml` to choose models, seeds, clocks and stop rule. The example
uses mock models only; for a live model, put its key in `.env` ([keys](#keys-env)).
Both files are git-ignored. Reference: [docs/bench.md](docs/bench.md).

## What it measures

Run both clocks on the same seed.

| | Real time | Frozen |
|---|---|---|
| While a model thinks | pieces keep falling | the game waits |
| An answer counts if | it arrives before the piece locks | it arrives within 30 s |
| What it measures | is the model fast enough for a live loop? | does the model place pieces well? |

- In `bun bench`, a frozen match gives every board the same number of pieces (`tetris.frozenPieces`, 100 by default; a frozen `sprint40` uses `tetris.maxPieces`) and has no early stop. On the page, a frozen run still stops at the time limit.
- Every board gets the same pieces in the same order, the same prompt and the same rules. Real-time matches share one clock.
- **Coming:** a board-only variant, to test 2D reasoning on its own. See [how it works](docs/how-it-works.md).

## Watch it in the page

```sh
bun dev             # http://localhost:5317
```

Press **Models**, tick up to six models, press **Test** on any model for one real move, then **Start live run**. The **Line-up** menu has mock line-ups that need no keys. **Load log** replays a saved `.jsonl` run log.

### Keys (`.env`)

| Model | Set in `.env` |
|---|---|
| Jev | `TYPESAFE_API_KEY` |
| Cloudflare Clef | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (Workers AI permission) |
| GPT-6.1 Sol, Claude Opus 5.5, Claude Haiku 5.5 (AWS Bedrock) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` or `AWS_PROFILE`; `AWS_REGION` (default `us-east-1`) |
| Any OpenAI-compatible chat model | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, or add it in the Models panel |
| Laya, Strands Decider | `LAYA_BASE_URL`, `STRANDS_BASE_URL`; `deploy/ec2/launch.sh` sets them |

Restart `bun dev` after editing `.env`. Keys stay on the server; the page never receives them. The server listens on `127.0.0.1` unless `HOST` is set.

Page-added models are saved in `models.local.json` (git-ignored). Laya and Strands Decider run on a GPU that costs money while it is up; [docs/self-hosting.md](docs/self-hosting.md) covers it.

## Extend it

- **Add a model:** [docs/models.md](docs/models.md). **Write an adapter:** [docs/models.md](docs/models.md#writing-a-new-adapter).
- **Write an environment:** the contract is in `src/core/types.ts`; see [docs/design/eval-engine.md](docs/design/eval-engine.md#environment-plugin).
- **Developer notes:** [development](docs/development.md), [API](docs/api.md), [configuration](docs/configuration.md).

## Contributing, security, citation, license

- [CONTRIBUTING.md](CONTRIBUTING.md) lists the checks: `bun run lint && bun run typecheck && bun test`.
- [SECURITY.md](SECURITY.md) covers reporting and how keys are handled.
- [CITATION.cff](CITATION.cff) feeds GitHub's "Cite this repository" button.
- [MIT](LICENSE). Third-party models and the [JevBench](https://github.com/fstandhartinger/jevbench) data in `benchmarks/` keep their own terms.
