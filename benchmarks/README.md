# Benchmark data

The raw results behind the tables in the [README](../README.md#latest-results), so anyone can check or recompute them.

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
