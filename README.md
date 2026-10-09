# Deadline Tetris

A side-by-side Tetris arena for comparing decision models on the same game. The
pieces keep falling while each model thinks, so an answer that arrives after the
piece locks doesn't count. It is built to compare a System One model (Jev)
against a regular LLM fairly, and it scales from two boards up to six.

Right now every board is driven by a **mock backend** that imitates each kind of
model (latency, placement quality, failures). The real provider adapters come next.

```sh
pnpm install
pnpm dev          # http://localhost:5317
pnpm test         # engine + simulation tests
CALIBRATE=1 pnpm test   # print how each mock profile fares
```

## How a run works

- Every board gets the **same seeded piece sequence** (7-bag randomizer).
- When a piece appears, the engine lists every legal landing spot (`option_1…N`)
  and asks the model to pick one. That is a `Choice` for Jev, and strict JSON for an LLM.
- **Real-time clock:** gravity keeps running. If the answer arrives before the
  piece locks, the piece goes to the chosen spot. If not, it drops where it is
  and counts as *too late*.
- **Frozen clock:** the game waits for every answer, which measures placement
  skill with speed taken out.
- Levels rise on a shared timer (every 15 s), following the guideline speed
  curve, so the deadline keeps shrinking until each model can't keep up.

## Layout

```
src/engine   pure game rules: pieces, board, gravity, landing spots, heuristic
src/arena    the backend ↔ UI contract (events), replay backend, clocked loop
src/mock     mock profiles + deterministic simulation that emits arena events
src/ui       React + canvas UI; state lives in a store, canvases draw per frame
scripts      Playwright screenshot helpers (needs `pnpm dev` running)
```

Every run is an ordered event stream (`run_started`, `spawn`, `decision`,
`lock`, `topout`, …). The UI only renders events, so the real server can
replace `MockBackend` without UI changes. Runs can be exported as JSONL and
replayed at any speed.
