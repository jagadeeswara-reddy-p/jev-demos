import { afterAll, describe, expect, test } from "bun:test";
import type { ModelConfig } from "./models/types";
import { sampleTurn, testModel } from "./sample";

// A chat API that always names an option the game never offered.
const server = Bun.serve({
  port: 0,
  fetch: () => Response.json({ choices: [{ message: { content: '{"choice":"option_999"}' } }] }),
});
afterAll(() => server.stop(true));

describe("testModel", () => {
  test("flags a choice that wasn't offered, and reports how many options were", async () => {
    const model: ModelConfig = { id: "c", label: "Chat", adapter: "completion", model: "fake", baseUrl: `http://localhost:${server.port}` };
    const result = await testModel(model);
    expect(result.status).toBe("invalid");
    expect(result.options).toBe(sampleTurn().action.options.length);
  });
});
