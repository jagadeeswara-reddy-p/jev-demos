# Server API and run logs

## Server API and run logs

**Who can call it.** The server listens on `127.0.0.1` unless `HOST` says otherwise, and
every `/api/` route checks the request first (`server/guard.ts`): the `Host` must be this
machine or a name in `ALLOWED_HOSTS`, and a request that changes something must declare a
JSON body and, when the browser sends an `Origin`, come from this server's own page. That
keeps other websites open in your browser from starting runs or reading your models.
Scripts calling the API directly need only `Content-Type: application/json` on writes.

**Statistics:** `bun run stats` reads every log in `runs/` and prints per-run
and per-model tables: wins, pieces landed, lines, too-late rate, best moves and
top-3 share, sprint results (target reached, time and pieces to it), answer-time
percentiles, in-time/late/invalid/error counts, deadline margin, tokens, cost
and Jev's confidence. Options: `--since <UTC time>`, `--min-decisions <n>`,
`--json <file>`, or a list of log files. Stopped and cut-off runs are handled.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/sources` | every source with its name, kind, and whether it's available (never keys) |
| GET | `/api/models` | every configured model: settings without the key, `hasKey`, availability |
| POST | `/api/models` | add a model (body: its settings); 400 with the field name if one is wrong |
| PUT / DELETE | `/api/models/:id` | change or remove a model added in the page (built-in ones live in `models.json`) |
| POST | `/api/models/:id/test` | one real decision (first piece of seed 1): status, choice, latency, tokens |
| GET / PUT | `/api/lineup` | the live line-up, `{ "sources": [...] }`; PUT saves it to `models.local.json` |
| POST | `/api/runs` | start a live run (body: run config); returns its id |
| GET | `/api/runs` | saved runs, newest first |
| GET | `/api/runs/:id/events` | server-sent event stream; catches up from the start, then goes live; resumes after a reconnect |
| GET | `/api/runs/:id/log` | the saved run as JSONL |
| POST | `/api/runs/:id/stop` | stop a run |

**Run logs** are saved to `runs/<timestamp>-seed<N>.jsonl`, one event per line.
The page's **Export log** produces the same format, so any log can be loaded and replayed.

| Event | When |
|---|---|
| `run_started` | first line; includes the full config |
| `level` | each level change, with the new gravity |
| `spawn` | a piece appears, with its legal options and its deadline |
| `move` | the piece moved (gravity or the drop after a decision) |
| `decision` | an answer arrived: status, choice, probabilities, latency, tokens, cost, and `bestRank` (the choice's rank by the reference heuristic) |
| `lock` | a piece locked: its cells, rows cleared, and the board after |
| `topout` / `survived` / `goal` | a board finished (`goal`: reached the sprint's line target) |
| `run_finished` | last line: `all_out`, `time_limit` or `stopped` |
