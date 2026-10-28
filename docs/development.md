# Development

Project layout, tests and tools, and known limitations. See also [CONTRIBUTING.md](../CONTRIBUTING.md).

## Project layout

```
models.json             built-in models (committed; keys as ${ENV} placeholders)
server/                 Bun server: page + API, live runs
  index.ts              routes
  config.ts             reads .env (port, files, default line-up)
  runs.ts               live runs on the wall clock, SSE, saving logs
  sources.ts            every source a board can use: configured models and mocks
  guard.ts              keeps other websites from calling the API (Host, Origin, Content-Type)
  sample.ts             one test decision outside a run (Test button, smoke script)
  adapters/             one file per wire format: completion.ts, decision.ts, bedrock.ts;
                        shared.ts (timing, errors, prices, the chat prompt), types.ts (the Adapter interface)
  models/               the model list: types.ts, validate.ts, env.ts (${ENV} placeholders), store.ts, health.ts (pings self-hosted models)
  routes/models.ts      /api/models and /api/lineup
  bench/                `bun bench`: the headless benchmark runner (see bench.md)
    cli.ts              init, doctor, run, demo; the command-line entry point
    config.ts           reads and checks bench.yaml, fills in its defaults
    entrants.ts         resolves the listed models; fills ${ENV} placeholders from .env
    plan.ts             the matches in order: variants, clocks, seeds
    preflight.ts        the checks before a run, and the time and cost estimate
    runner.ts           plays the matches one at a time; stop rule, resume, cost limit, bench.json
src/core/               the engine contract, independent of any game
  types.ts              Turn, Answer, Agent, Match, Environment
  turn.ts               helpers for turns (observationText)
src/engine/             game rules: pieces, board, gravity, landing spots, the hand-written evaluator
src/arena/              Tetris as an environment
  environment.ts        the `tetris` Environment: id, version, variants, createMatch
  simulation.ts         one match: clock, levels, deadlines, decisions, drops, events, grading
  turn.ts               builds the Turn for one piece
  ranking.ts            who wins: the survival and sprint rules
  prompt.ts             the text every model receives
  types.ts              config, events, TetrisTurnDetail and TetrisAgent, DEFAULT_CONFIG
  serverBackend.ts      browser ↔ server (live runs)
  replayBackend.ts      replays and JSONL import/export
src/mock/               mock profiles and the in-browser mock backend
src/ui/                 React + canvas UI, theme, store; ModelsPanel.tsx and ModelForm.tsx
deploy/ec2/             a short-lived GPU box serving Laya and Strands Decider (common.sh is shared by the scripts)
benchmarks/             the published benchmark data (game logs and JevBench results), by date
scripts/                stats.ts, smoke.ts, position-bias.ts (shuffle test), fake-providers.ts
docs/                   findings, how it works, models, configuration, self-hosting, API, development; media/ (demo videos)
runs/                   saved live runs (git-ignored)
```

## Testing and tools

```sh
bun run lint                # Biome: formatting and lint (bun run format fixes what it can)
bun run typecheck
bun test                    # engine, simulation, adapters, model store and API tests
CALIBRATE=1 bun test        # also print how each mock profile fares
bun run stats               # statistics from saved runs (see the README's Benchmarks)
bun run smoke               # one real decision from every model that can run
bun run smoke live-laya -n 5   # chosen models, five times each, with the median round trip
bun run fake-providers      # stand-in Decisions and Chat Completions APIs on :5400
```

**Rehearsing without keys or cost:** start `bun run fake-providers`, then in the
page's Models panel add a Decision model at `http://localhost:5400` and a
Completion model at `http://localhost:5400/v1` (any model name and key).

**Shuffle test:** `bun scripts/position-bias.ts live-laya live-jev` asks the same twelve
boards with the options in six different orders, and reports position bias,
consistency and best moves per model (see [findings.md](findings.md)).

## Known limitations

- **"Lands N rows above the floor" is off by one.** A piece resting on the floor reads as "1 row above the floor".
- **No advanced moves.** Wall kicks, tucks under overhangs and T-spins aren't in the option list.
- **Dashed outlines after a line clear** are drawn at their pre-clear height, so they can appear to float.
- **Laya runs on hardware you choose.** Its latency reflects that machine, not just the model.
- **Live latency includes your network.** Running from a different region changes the numbers.
- **One seed is one game.** Compare across several seeds before drawing conclusions.
- **Speed and survival are linked.** A faster model places more pieces per minute, so with the same placement quality its stack also rises faster. That's why the winner is decided by pieces landed (or, in a sprint, by reaching 40 lines), not by time survived.
- **Costs are recorded when each answer arrives.** Runs made before a model's prices were set keep $0 for that model.
- **GPT-6.1 Sol's price isn't in AWS's price list.** It comes from third-party Bedrock listings; Claude Haiku 5.5's comes from the AWS Price List API.
- **Claude Opus 5.5 can't be forced to use the answer tool on Bedrock**, so its entry has `"toolChoice": "auto"`: the same tool is offered, and it may answer in text instead. The answer must still name an offered option.
- **Bedrock session credentials expire.** When they do, live Bedrock boards fail with errors: refresh the `AWS_*` values in `.env` and restart.
- **Rotations cost time.** Each rotation is another copy of the question for the model to score, so a decision model with `rotations: 4` does about four times the work per move.
- **Runs started through the API** (`POST /api/runs`) don't appear in a page that's already open. Watch them by replaying their log afterwards.
