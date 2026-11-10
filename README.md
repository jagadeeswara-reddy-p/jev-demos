# decision-bench

[![CI](https://github.com/jagadeeswara-reddy-p/jev-demos/actions/workflows/ci.yml/badge.svg)](https://github.com/jagadeeswara-reddy-p/jev-demos/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Can a model make a good decision fast enough to act on it?**

Most benchmarks give a model as long as it likes to answer. Agents, games and other live systems don't, because a late answer counts for nothing. decision-bench puts models in a game where the clock keeps running while they think, then measures two things: how well each model chooses, and whether its choice arrives in time.

The first environment is **Deadline Tetris**. Every model plays the same pieces in the same order, and each piece keeps falling while the model decides where it should go.

[![Six models playing Deadline Tetris](docs/media/demo-six-models.gif)](docs/media/demo-six-models.mp4)

*The six models below, playing the same Live game side by side, sped up 6×. Click for the full video.*

## Results

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/results-dark.svg">
  <img alt="Benchmark results: good-move rate against answer time, and pieces placed in time per live game" src="docs/media/results-light.svg">
</picture>

**Language models choose best but answer too slowly for falling pieces. The small open decision models answer fast but choose poorly. Jev is the only model that does both, so it places the most pieces.**

Six models, four Live games each, measured on 2026-10-17. Each game was stopped once four of the six boards had filled up.

<details>
<summary>Full numbers</summary>

| Model | Type | Good-move rate ↑ | Typical answer time ↓ | Pieces placed in time ↑ | Answers too late ↓ | Cost for 4 games ↓ |
|---|---|---|---|---|---|---|
| Jev | decision model | 59% | 289 ms | **118.8** | 0% | $0.03 |
| Cloudflare Clef | decision model | 48% | 438 ms | 69.3 | <1% | $0.11 |
| GPT-6.1 Sol | language model | 72% | 2.04 s | 23.3 | 13% | $0.48 |
| Strands Decider | decision model | 15% | 435 ms | 21.0 | 1% | self-hosted |
| Laya | decision model | 7% | 452 ms | 20.5 | 0% | self-hosted |
| Claude Opus 5.5 | language model | **79%** | 5.14 s | 9.5 | 46% | $1.02 |

↑ higher is better, ↓ lower is better. Every number is an average over the four games.

</details>

| Measure | What it means |
|---|---|
| **Good-move rate** ↑ | How often the model picked the best spot for the piece, as scored by a standard hand-written Tetris evaluator.[^grading] |
| **Typical answer time** ↓ | The median time from showing the model a piece to getting its answer. |
| **Pieces placed in time** ↑ | Pieces that landed where the model chose, because its answer arrived before the piece hit the floor. This is the headline number. |
| **Answers too late** ↓ | The share of pieces that landed before the model had answered. |

To recompute everything from the raw logs in [benchmarks/2026-10-17](benchmarks/README.md):

```sh
bun bench chart benchmarks/2026-10-17/tetris    # redraws the chart above
bun run stats benchmarks/2026-10-17/tetris/*.jsonl
```

Earlier and later rounds, including Claude Haiku 5.5, are in the [results history](docs/results-history.md). Why each model scores the way it does is in [findings](docs/findings.md).

[^grading]: The evaluator is a yardstick, not the truth: it looks one piece ahead, so a model that plans further can lose a point for a better move. Late answers are graded too, so the rate measures choice apart from speed. In these games it is the average per game over every answer. See [how answers are judged](docs/how-it-works.md#how-each-answer-is-judged).

## The environment: Deadline Tetris

A standard 10 × 20 Tetris board, with one change: **the game doesn't wait for the model.**

1. A piece appears, and the model gets the board and a numbered list of every legal landing spot.
2. The model answers with one number.
3. If the answer arrives before the piece lands, the piece goes there. If not, it lands wherever it fell, and that counts as too late.

The game speeds up every 15 seconds, so the time to answer keeps shrinking. A board is out when it fills up, and a game lasts at most 10 minutes.

There are two modes. You can run both on the same pieces:

| | **Live** | **Paused** |
|---|---|---|
| While the model thinks | the piece keeps falling | the game waits (up to 30 s) |
| It answers | can the model choose well *and* in time? | can the model choose well at all? |

The page and `bench.yaml` call these the *real-time* and *frozen* clocks. The full rules and timings are in [how it works](docs/how-it-works.md).

## How we keep it fair

- **Same game for everyone.** Every model gets the same pieces, the same prompt and the same list of options. In Live mode all the boards share one clock.
- **Same answer format.** Every model must name one of the offered options. Any other reply counts as a bad answer, and nothing is guessed from free text.
- **Several games.** We report the average over every game. We don't yet report error bars.
- **Real costs.** Cost is the provider's list price for the tokens actually used.

## Quick start (no keys)

Needs [Bun](https://bun.sh) 1.4 or later.

```sh
git clone https://github.com/jagadeeswara-reddy-p/jev-demos && cd jev-demos
bun install
bun bench demo      # six mock models, no API calls; finishes in about a second
```

## Benchmark your own models

```sh
bun bench init      # writes bench.yaml and .env from the examples
bun bench doctor    # checks each model and its key
bun bench run       # plays the games and writes the logs
bun bench chart runs/bench/<name>    # draws the chart above for your run
```

Choose the models, games and modes in `bench.yaml`, and put API keys in `.env` ([which keys](docs/configuration.md#built-in-models)). Both files are git-ignored. Reference: [docs/bench.md](docs/bench.md).

### Watch it in the browser

```sh
bun dev             # http://localhost:5317
```

Press **Models**, tick up to six, then **Start live run**. The **Line-up** menu has mock line-ups that need no keys, and **Load log** replays any saved game, including the ones in `benchmarks/`.

## Known limitations

- **No error bars yet.** Four games per model is enough to rank these six, but not to separate models that score close together.
- **The evaluator is a yardstick.** A model that plans ahead can disagree with it and still be right (see the footnote above).
- **Network latency is included.** Every request went from one machine in India, which adds about 0.2–0.3 s per answer. Laya and Strands Decider ran on our own GPU in AWS us-east-1.
- **One environment so far.** A board-only variant that tests 2D reasoning on its own is next ([design](docs/design/eval-engine.md)).

## Documentation

| Page | What's in it |
|---|---|
| [How it works](docs/how-it-works.md) | Rules, timings, the prompt every model gets, how answers are judged |
| [Findings](docs/findings.md) | Why each model scores the way it does, and what we tried |
| [Results history](docs/results-history.md) | Every published round, including the JevBench text-decision results |
| [bun bench](docs/bench.md) | Every `bench.yaml` setting and command |
| [Models](docs/models.md) | Adding a model, or writing an adapter for a new kind |
| [Configuration](docs/configuration.md) | Keys, prices and server settings |
| [Self-hosting](docs/self-hosting.md) | Running Laya and Strands Decider on a GPU |
| [Development](docs/development.md) · [API](docs/api.md) | Code layout, tests and the server API |
| [Eval engine design](docs/design/eval-engine.md) | Where this is going: writing a new environment |

## Contributing, security, citation, license

- [CONTRIBUTING.md](CONTRIBUTING.md) lists the checks: `bun run lint && bun run typecheck && bun test`.
- [SECURITY.md](SECURITY.md) covers reporting and how keys are handled.
- [CITATION.cff](CITATION.cff) feeds GitHub's "Cite this repository" button.
- [MIT](LICENSE). Third-party models and the [JevBench](https://github.com/fstandhartinger/jevbench) data in `benchmarks/` keep their own terms.
