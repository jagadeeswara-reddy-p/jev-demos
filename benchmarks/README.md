# Benchmark data

The raw results behind the tables in the [README](../README.md#latest-results), so anyone can check or recompute them.

## 2026-10-28

**`bench/`**: a `bun bench run` of Jev, GPT-6.1 Sol, Claude Opus 5.5, Claude Haiku 5.5 and the reference heuristic on Deadline Tetris v3: 3 seeds on each clock, 40 pieces per model on the frozen clock, 2-minute games in real time. One log per match, plus `bench.json` (the config as run, with every match's outcome and cost) and `settings.json`.

```sh
bun bench chart benchmarks/2026-10-28/bench           # the README chart (docs/media/results-*.svg)
bun run stats benchmarks/2026-10-28/bench/*.jsonl      # every number per match and per model
```

All requests came from the same machine in India, through each provider's API (Bedrock in us-east-1 for GPT and Claude), so latencies include about 0.2–0.3 s of network. Total cost $4.48.

## 2026-10-17

**`tetris/`**: the four live games (seeds 1–4, real-time clock, six models), one event per line, exactly as the server logged them. Each game was stopped once four of the six boards had topped out.

```sh
bun run stats benchmarks/2026-10-17/tetris/*.jsonl    # every table in the README's Tetris section
```

Load any file in the page (**Load log** in the top bar) to replay the game.

**`jevbench/`**: one file per model, each with JevBench's own per-question results for the 231 public questions
([JevBench](https://github.com/fstandhartinger/jevbench) v1.0.0, commit `609a664`), as written by its `run` command. Accuracy per model:

```sh
for f in benchmarks/2026-10-17/jevbench/*.jsonl; do
  echo "$(basename "$f" .jsonl): $(jq -s '(map(select(.correct)) | length) * 100 / length' "$f")%"
done
```

Laya and Strands Decider ran on one NVIDIA A10G in AWS us-east-1; every other model through its provider's API. All
requests came from the same machine in India, so latencies include about 0.2–0.3 s of network.
