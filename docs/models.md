# Models and adapters

Every board in a live run is driven by a **model**: one entry with a name, an
address, a key and a few settings. The model's **adapter** turns each Tetris
decision into one API call and the reply back into an answer. The rest of the
arena (the game, the clock, scoring, the screens) never sees a provider's wire
format, so a model that speaks a supported API needs only settings, no code.

- [Where models come from](#where-models-come-from)
- [Settings](#settings)
- [Completion adapter](#completion-adapter)
- [Decision adapter](#decision-adapter)
- [Bedrock adapter](#bedrock-adapter)
- [Checking a model](#checking-a-model)
- [Writing a new adapter](#writing-a-new-adapter)

## Where models come from

| File | Committed | Holds | Edited |
|---|---|---|---|
| `models.json` | yes | the built-in models, with keys and addresses as `${ENV_VAR}` placeholders | by hand |
| `models.local.json` | no (git-ignored, mode 600) | models added in the page, with their keys, and the saved line-up | in the page's **Models** panel, or by hand |

Both files list models in the same shape:

```json
{
  "models": [
    {
      "id": "live-jev",
      "label": "Jev",
      "adapter": "decision",
      "baseUrl": "https://api.typesafe.ai",
      "model": "jev-latest",
      "apiKey": "${TYPESAFE_API_KEY}",
      "prices": { "inputPerM": 0.042, "outputPerM": 0 }
    }
  ]
}
```

`models.local.json` also has `"lineup": ["live-jev", "bedrock-gpt", ...]` once a
line-up is picked in the page. Until then the line-up is `LINEUP` from `.env`.

**Placeholders** are filled from the environment (`.env`) when the server starts:

| Written | Means |
|---|---|
| `${NAME}` | required: the model shows as unavailable ("Set NAME in .env") until `NAME` is set |
| `${NAME:-default}` | optional: uses `default` when `NAME` is unset; the default may be empty or another placeholder |

Placeholders work in any text setting: `"url": "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/cloudflare/clef"`,
`"label": "${LLM_LABEL:-${LLM_MODEL:-Chat model}}"`.

Ids must be unique across both files and the mock sources. Built-in models can't
be changed or removed from the page; models added in the page can.

## Settings

| Setting | Adapters | Meaning | Default |
|---|---|---|---|
| `id` | all | Source id used in line-ups and run logs: lowercase letters, digits and dashes, up to 40. The page makes one from the name. | — |
| `label` | all | Name on the board, up to 40 characters. | — |
| `adapter` | all | `completion`, `decision` or `bedrock`. The page offers the first two. | — |
| `description` | all | One line shown as the board's tooltip, e.g. where the model runs. | the model name and adapter |
| `baseUrl` | completion, decision | API root. The adapter adds its path: `/chat/completions` or `/v1/systemone`. | — |
| `url` | completion, decision | Full request address, for APIs with a different path. Replaces `baseUrl` + path. | — |
| `model` | all | Model name sent in the request; for bedrock, the model or inference profile id. | — |
| `apiKey` | completion, decision | Sent as `Authorization: Bearer <key>`. Leave it out for servers without auth. | none |
| `timeoutMs` | all | Give up on a call after this long; the answer counts as an error. | 60000 (completion, bedrock), 30000 (decision) |
| `prices` | all | `{ "inputPerM", "outputPerM" }` in USD per million tokens, for the cost column. Bedrock also takes `cacheReadPerM` and `cacheWritePerM` (default: the input price). | free |
| `healthCheck` | completion, decision | A path on `baseUrl` that answers 200 when the server is up, e.g. `/health`. The server pings it (2 s timeout, cached 10 s) before listing models, before a run and before a Test move, and shows the model as unavailable when it doesn't answer. Set it for self-hosted models. | none |
| `extraBody` | all | JSON object merged into every request body (bedrock: sent as `additionalModelRequestFields`). For provider options such as `{"reasoning_effort": "low"}` or Laya's token budgets. | none |
| `jsonMode` | completion | How the answer is constrained: `schema` (strict JSON schema), `object` (JSON mode) or `none` (plain text containing the JSON). | `schema` |
| `maxTokens` | completion, bedrock | Reply token limit. | provider default (bedrock: 1024) |
| `rotations` | decision | Ask the question this many times with the option order shifted, and average. See [rotations](#rotations). 1 is off. | 1 |
| `toolChoice` | bedrock | `tool` forces the answer tool; `auto` offers it without forcing, for models that refuse a forced tool. | `tool` |

A setting that doesn't apply to the model's adapter is rejected, with a message
saying which adapter it belongs to.

## Completion adapter

`server/adapters/completion.ts`. For chat models behind an OpenAI-compatible
Chat Completions API: OpenAI, OpenRouter, Groq, Together, vLLM, Ollama, LM Studio,
Gemini's OpenAI endpoint, most gateways.

```http
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}

{
  "model": "{model}",
  "messages": [
    { "role": "system", "content": "You are playing Tetris. Choose where the current piece should land. ... Reply with JSON only, in the form {\"choice\": \"<option id>\"}." },
    { "role": "user", "content": "Board, 10 columns by 20 rows, ...\n\nOptions:\noption_1: Rotation 1, columns 1-2, ...\n..." }
  ],
  "response_format": { "type": "json_schema", "json_schema": { "name": "placement", "strict": true, "schema": { ... "enum": ["option_1", ...] } } },
  ...extraBody
}
```

The reply's `choices[0].message.content` must be JSON naming one of the offered
options, `{"choice": "option_7"}`, optionally in a code fence. Anything else
counts as a bad answer; nothing is guessed from free text. Token counts come
from `usage.prompt_tokens` and `usage.completion_tokens`.

If the API rejects strict schemas, set `jsonMode` to `object` or `none`.

## Decision adapter

`server/adapters/decision.ts`. For models that score a fixed set of options
instead of writing text, over the Decisions API (TypeSafe's `/v1/systemone`).
Jev, Laya's `laya-serve`, Cloudflare Clef and AWS Strands Decider's `strands-decider serve` speak it.

```http
POST {baseUrl}/v1/systemone
Authorization: Bearer {apiKey}

{
  "model": "{model}",
  "state": "Board, 10 columns by 20 rows, ...",
  "questions": {
    "placement": {
      "type": "choice",
      "instructions": "You are playing Tetris. Choose where the current piece should land. ...",
      "criteria": { "option_1": "Rotation 1, columns 1-2, lands 1 row above the floor; ...", "option_2": "..." }
    }
  },
  ...extraBody
}
```

```json
{
  "answers": { "placement": { "choice": "option_2", "probabilities": { "option_1": 0.04, "option_2": 0.71 }, "confidence": 0.68 } },
  "usage": { "input_tokens": 2235, "output_tokens": 350 }
}
```

- A reply wrapped as `{ "result": { ... } }` (Cloudflare Workers AI) is unwrapped.
- `prompt_tokens` and `completion_tokens` are read when `input_tokens` and `output_tokens` aren't there.
- If the server reports `usage.truncated` or `usage.truncated_questions` (laya-serve
  does), the answer carries a note and the server prints a warning once.
- The probabilities drive the dashed "alternatives" outlines on the board.

### Rotations

Some decision models prefer options by where they are listed, not by what they
say. Laya's README measures this on five options with identical text: the first
slots win. With `rotations: N` the adapter sends N copies of the question in one
request, `placement_0` … `placement_{N-1}`. Each copy carries an `option_order`,
a permutation in which slot `s` shows option `option_order[s]`, shifted evenly
across the copies. The adapter averages the probabilities and picks the highest.

- With as many rotations as options, every option sits in every slot exactly once.
  Fewer rotations are cheaper and still spread the options out.
- Each copy is a full question for the model, so N rotations cost about N times
  the compute per move, and the latency shows it.
- The server must accept `option_order` on choice questions: laya-serve does.
  Jev accepts the request. Cloudflare Clef rejects it with a 422. Strands Decider's
  server accepts the request but ignores the field, so rotations would only repeat
  the same question there.

## Bedrock adapter

`server/adapters/bedrock.ts`. For chat models on AWS Bedrock, through the
Converse API, which has one request shape for every provider. It sends the same
system and user text as the completion adapter, and asks for the answer as a call
to a `choose_placement` tool whose input is limited to the offered option ids.

Bedrock requests are signed with AWS credentials, so this adapter is for
`models.json` only. Credentials and region come from the usual `AWS_*`
variables or `AWS_PROFILE`. Bedrock reports prompt-cache reads and writes
separately: they count as input tokens, each priced at its own rate.

```json
{
  "id": "bedrock-opus",
  "label": "claude-opus-5-5",
  "adapter": "bedrock",
  "model": "us.anthropic.claude-opus-5-5",
  "toolChoice": "auto",
  "prices": { "inputPerM": 4.4, "outputPerM": 22, "cacheReadPerM": 0.22, "cacheWritePerM": 5.5 }
}
```

## Checking a model

Each model has a **Test** button in the Models panel. It sends one real
decision: the first piece of seed 1, with all 34 landing spots as options. The
panel shows the choice, the round trip and the tokens, or the error. The same
check runs from the command line:

```sh
bun run smoke                       # every model that can run, once
bun run smoke live-laya live-jev -n 5   # chosen models, five times, with the median
```

`bun run fake-providers` starts stand-in Decisions and Chat Completions APIs
on port 5400, for trying the whole flow without keys or cost.

## Writing a new adapter

An adapter is one object implementing `Adapter` from `server/adapters/types.ts`:

```ts
export interface Adapter {
  kind: AgentKind;                // "system-one" or "llm": how its boards are classed in results
  defaultTimeoutMs: number;
  unavailable?(model: ModelConfig, env: Env): string | undefined;   // e.g. missing credentials
  decide(model: ModelConfig, turn: Turn, signal: AbortSignal): Promise<Answer>;
}
```

`decide` gets the model with its placeholders filled and one `Turn` from
`src/core/types.ts`. An adapter builds its request from these fields only:

| Field | What it holds |
|---|---|
| `instructions` | the task, e.g. "You are playing Tetris. Choose where the current piece should land. …" |
| `observation` | what the model is shown, as text parts; `observationText(turn)` from `src/core/turn.ts` joins them |
| `action.options` | the choices, in order, each `{ id, text }`: for Tetris, `option_N` and its description |
| `deadlineMs` | how long until the answer stops counting |

`turn.detail` is the environment's own view (for Tetris: the board, piece and
landing spots). Mocks and baselines read it; **adapters must not**, so that
every adapter works for every environment and every model gets the same text.

`decide` returns `{ status: "ok", choice, probabilities?, confidence?, usage }`,
or `invalid` or `error` with a `detail`. It must pass `signal` to its HTTP
call. A throw counts as an error answer, and latency is measured around the
call for you.

Steps:

1. Build the request from the `Turn`, or with the chat helpers in
   `server/adapters/shared.ts` (`systemText`, `userText`, `choiceSchema`,
   `parseChoice`). Every model must get the same information, or the
   comparison stops being fair.
2. Add the file under `server/adapters/`, keeping request building and reply
   reading in exported functions so they can be tested without a network
   (see `decisionBody` / `readDecision`).
3. Add its name to `AdapterName` in `server/models/types.ts` and to the
   `ADAPTERS` map in `server/adapters/index.ts`. If it has settings of its own,
   add them to `ModelConfig` and to `ONLY` in `server/models/validate.ts`.
4. Write `server/adapters/<name>.test.ts` against a local fake server (`Bun.serve({ port: 0 })`).
5. To offer it in the page, add it to `ADAPTERS` in `src/ui/ModelForm.tsx` and
   allow it in `validateModel`.
6. Document its wire format here.
