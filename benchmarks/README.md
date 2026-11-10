# Benchmark data

The raw logs behind the [README](../README.md#results) and the [results history](../docs/results-history.md), so anyone can check or recompute them.

## 2026-10-28

**`bench/`**: a `bun bench run` of Jev, GPT-6.1 Sol, Claude Opus 5.5, Claude Haiku 5.5 and the reference heuristic on Deadline Tetris (rules version 3): 3 games in each mode, 40 pieces per model when Paused (the *frozen* clock in the logs), 2-minute Live games (*realtime*). One log per game, plus `bench.json` (the config as run, with every game's outcome and cost) and `settings.json`.

```sh
bun bench chart benchmarks/2026-10-28/bench --out docs/media/results-2026-10-28   # the results-history chart
bun run stats benchmarks/2026-10-28/bench/*.jsonl      # every number per match and per model
```

All requests came from the same machine in India, through each provider's API (Bedrock in us-east-1 for GPT and Claude), so latencies include about 0.2–0.3 s of network. Total cost $4.48.

## 2026-10-17

**`tetris/`**: the four Live games (games 1–4, six models), one event per line, exactly as the server logged them. Each game was stopped once four of the six boards had topped out. `bench.json` only records the date and environment, so `bun bench chart` can name them.

```sh
bun bench chart benchmarks/2026-10-17/tetris          # the README chart (docs/media/results-*.svg)
bun run stats benchmarks/2026-10-17/tetris/*.jsonl    # every number per game and per model
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
