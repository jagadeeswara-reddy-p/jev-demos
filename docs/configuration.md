# Configuration

Every model setting and `.env` variable. For the adapters and their wire formats, see [models.md](models.md).

## Models and configuration

Every model on a board goes through one of three **adapters**, chosen by the API it speaks:

| Adapter | API | For | Offered in the page |
|---|---|---|---|
| **Completion** | OpenAI-compatible Chat Completions, `POST {baseUrl}/chat/completions` | chat models: OpenAI, OpenRouter, Groq, Together, vLLM, Ollama, Gemini's OpenAI endpoint, gateways | yes |
| **Decision** | the Decisions API, `POST {baseUrl}/v1/systemone` | models that score options: Jev, Laya, Cloudflare Clef, AWS Strands Decider | yes |
| **Bedrock** | AWS Bedrock's Converse API (signed AWS requests) | chat models on Bedrock | no; `models.json` only |

Models come from two files:

- **`models.json`** (committed): the built-in models. Keys and addresses are
  `${ENV_VAR}` placeholders filled from `.env`, so the file holds no secrets. A
  model whose variables aren't set shows as unavailable, with the reason.
- **`models.local.json`** (git-ignored, mode 600): models added in the page,
  with their keys, and the line-up you picked. It is plain JSON and can be
  edited by hand.

**Adding a model in the page:** **Models** → **Add model**, pick Completion or
Decision, and give a name, the API address, the model name and a key. **More
settings** has prices (for the cost column), a timeout, a full request address
(for APIs with an unusual path, like Cloudflare's), extra request fields, and
per-adapter options. Saving runs one test move straight away.

The full reference (every setting, both wire formats, how to write a new
adapter) is in **[docs/models.md](models.md)**.

### Built-in models

| Id | Model | Adapter | Needs in `.env` |
|---|---|---|---|
| `live-jev` | Jev (`jev-latest`), TypeSafe | Decision | `TYPESAFE_API_KEY` |
| `live-clef` | Cloudflare Clef, Workers AI | Decision | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` |
| `live-laya` | Laya `typed-decisions`, self-hosted ([Running Laya](self-hosting.md)) | Decision | `LAYA_BASE_URL` (`LAYA_API_KEY` if set on the server) |
| `live-strands` | AWS Strands Decider 2B, self-hosted (`strands-decider serve`) | Decision | `STRANDS_BASE_URL` |
| `live-llm` | any OpenAI-compatible chat model | Completion | `LLM_MODEL`, `LLM_API_KEY` (`LLM_BASE_URL`, `LLM_LABEL` optional) |
| `bedrock-gpt` | GPT-6.1 Sol | Bedrock | AWS credentials |
| `bedrock-opus` | Claude Opus 5.5 | Bedrock | AWS credentials |
| `bedrock-haiku` | Claude Haiku 5.5 | Bedrock | AWS credentials |

Mock sources (simulated in the browser, no API calls) can also be in a line-up:
`jev`, `llm-fast`, `llm-frontier`, `llm-flaky`, `heuristic`, `random`, `no-input`.

### Other settings (`.env`)

| Setting | What it does | Default |
|---|---|---|
| `PORT` | Port for the page and API | `5317` |
| `LINEUP` | The line-up until one is picked in the page, as model ids, left to right. Up to 6. | `live-jev,live-llm` |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` (or `AWS_PROFILE`) | Credentials for the Bedrock adapter. Temporary session credentials expire and must be refreshed. | `us-east-1` |
| `MODELS_FILE`, `LOCAL_MODELS_FILE` | Where the two model files are | `models.json`, `models.local.json` |
| `RUNS_DIR` | Where live runs are saved | `runs` |

**Keys stay on the server.** The page only learns each model's name, settings
without the key, and whether it can run. `.env` is read once at startup:
**restart `bun dev` after editing it.**

Prices in `models.json` (USD per million tokens, regional `us.` inference profiles for Bedrock):

| Model | Input | Output | Cache read | Cache write | Source |
|---|---|---|---|---|---|
| Jev (`jev-latest`) | 0.042 | 0 | — | — | TypeSafe |
| Cloudflare Clef | 0.24 | 0 | — | — | Workers AI pricing (`clef-flash`: 0.09) |
| gpt-6.1-sol | 2.20 | 11.00 | 0.11 | 2.75 | third-party Bedrock listings (OpenAI's $2 / $10 plus Bedrock's 10% regional premium) |
| claude-haiku-5-5 | 0.11 | 0.55 | 0.011 | 0.1375 | AWS Price List API |
| claude-opus-5-5 | 4.40 | 22.00 | 0.22 | 5.50 | AWS Price List API (cache write: the listed global $5.00 plus the 10% regional premium) |
