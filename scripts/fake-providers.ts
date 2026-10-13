// Stand-in for a Decisions API and an OpenAI-compatible Chat Completions API,
// speaking the same wire formats, so the live path can be tried without keys or cost.
//
//   bun scripts/fake-providers.ts            # listens on :5400
//   LLM_BASE_URL=http://localhost:5400/v1 LLM_API_KEY=fake LLM_MODEL=fake bun dev
//
// Or add models in the page's Models panel: a Decision model at http://localhost:5400
// and a Completion model at http://localhost:5400/v1 (any model name, any key).
//
// It scores each option from the feature text in its description, so its picks
// are sensible but not perfect. Delays: FAKE_JEV_MS (default 260), FAKE_LLM_MS (default 750).

const port = Number(Bun.env.FAKE_PORT ?? 5400);
const jevMs = Number(Bun.env.FAKE_JEV_MS ?? 260);
const llmMs = Number(Bun.env.FAKE_LLM_MS ?? 750);

const num = (text: string, re: RegExp) => Number(text.match(re)?.[1] ?? 0);

function score(description: string): number {
  const lines = num(description, /clears (\d+) line/);
  const holes = num(description, /creates (\d+) hole/) - num(description, /opens (\d+) hole/);
  const height = num(description, /stack height after: (\d+)/);
  const bumpy = num(description, /bumpiness after: (\d+)/);
  const lands = num(description, /lands (\d+) row/);
  return lines * 8 - holes * 9 - height * 1.5 - bumpy * 0.6 - lands * 1.2;
}

function decide(options: Record<string, string>, temperature: number) {
  const ids = Object.keys(options);
  const scores = ids.map((id) => score(options[id] ?? ""));
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((e) => e / sum);
  let u = Math.random();
  let pick = ids.length - 1;
  for (let i = 0; i < ids.length; i++) {
    u -= probs[i];
    if (u <= 0) {
      pick = i;
      break;
    }
  }
  return { choice: ids[pick], probabilities: Object.fromEntries(ids.map((id, i) => [id, probs[i]])), probs };
}

/** Parses "option_N: description" lines out of a chat prompt. */
function optionsFromPrompt(text: string): Record<string, string> {
  return Object.fromEntries([...text.matchAll(/^(option_\d+): (.*)$/gm)].map((m) => [m[1], m[2]]));
}

const jitter = (ms: number) => ms * Math.exp(0.2 * (Math.random() * 2 - 1));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, jitter(ms)));
const tokens = (body: unknown) => Math.round(JSON.stringify(body).length / 4);

Bun.serve({
  port,
  routes: {
    "/v1/systemone": {
      POST: async (req) => {
        type Question = { criteria: Record<string, string>; option_order?: number[] };
        const body = (await req.json()) as { questions: Record<string, Question> };
        await sleep(jevMs);
        // Every question is answered, so rotated copies (option_order) work too; order doesn't matter here.
        const answers = Object.fromEntries(
          Object.entries(body.questions).map(([id, q]) => {
            const { choice, probabilities, probs } = decide(q.criteria, 2.5);
            return [id, { type: "choice", choice, probabilities, confidence: Math.max(...probs) }];
          }),
        );
        return Response.json({ model: "decision-fake", answers, usage: { input_tokens: tokens(body), output_tokens: 0 } });
      },
    },
    "/v1/chat/completions": {
      POST: async (req) => {
        const body = (await req.json()) as { messages: { content: string }[] };
        await sleep(llmMs);
        const { choice } = decide(optionsFromPrompt(body.messages.at(-1)!.content), 2.5);
        return Response.json({
          choices: [{ message: { role: "assistant", content: JSON.stringify({ choice }) } }],
          usage: { prompt_tokens: tokens(body), completion_tokens: 8 },
        });
      },
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});

console.log(`Fake providers on http://localhost:${port} (decisions ~${jevMs} ms, completions ~${llmMs} ms)`);
