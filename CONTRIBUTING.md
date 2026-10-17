# Contributing

Thanks for helping. This project compares decision models fairly, so the one
rule that matters most: **every model must get the same game, the same
information and the same rules.** A change that helps one model see more, or
gives it more time, needs a very good reason and a note in the README.

## Setting up

```sh
bun install
cp .env.example .env    # keys only for the models you want to try
bun dev                 # http://localhost:5317
```

No keys? The mock line-ups run in the browser, and `bun run fake-providers`
stands in for a Decisions API and a Chat Completions API (see the README, "Testing and tools").

## Before sending a change

```sh
bun run lint        # Biome: formatting and lint (bun run format fixes what it can)
bun run typecheck
bun test
```

All three run in CI on every pull request.

## Where things go

| Change | Where |
|---|---|
| A model that speaks a supported API | `models.json` (built-in) or the page's Models panel; no code |
| A new wire format | a new adapter in `server/adapters/`; follow [docs/models.md](docs/models.md#writing-a-new-adapter) |
| Game rules, timings, scoring | `src/engine/`, `src/arena/` (`DEFAULT_CONFIG` in `src/arena/types.ts`) |
| What models are told | `src/arena/prompt.ts`; this changes every model's input, so say why |
| Screens | `src/ui/` |

## Code style

- TypeScript, strict. Match the code around you: short header comments that say
  what a file is for, comments only where the reason isn't obvious from the code.
- Keep request building and reply parsing in pure, exported functions, so they
  can be tested without a network.
- Tests live next to the code as `*.test.ts` and use `bun:test`. Adapters are
  tested against a local `Bun.serve({ port: 0 })` fake, never a real API.
- User-facing text: plain words, sentence case, say what happened and what to do.

## Secrets

Keys belong in `.env` or `models.local.json`, both git-ignored. Never commit
them, paste them in issues, or put them in `models.json`: use a `${ENV_VAR}`
placeholder there instead. The server never sends a key to the browser; keep it that way.
