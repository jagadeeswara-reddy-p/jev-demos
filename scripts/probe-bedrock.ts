// Sends the real Tetris prompt to one Bedrock model and prints the raw usage and answer.
//   bun scripts/probe-bedrock.ts us.openai.gpt-6.1-sol
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { TetrisGame } from "../src/engine/game";
import { encodeBoard } from "../src/engine/board";
import type { DecisionRequest } from "../src/arena/types";
import { SYSTEM, choiceSchema, userText } from "../server/sources/llm";

const modelId = process.argv[2];
if (!modelId) throw new Error("Usage: bun scripts/probe-bedrock.ts <model-id>");
const game = new TetrisGame(1);
game.spawn();
const req: DecisionRequest = {
  agentId: "probe", pieceId: 1, type: game.active!.type, board: encodeBoard(game.board), next: game.preview,
  candidates: game.candidates().map(({ id, rot, x, y, cells }) => ({ id, rot, x, y, cells })),
  level: 1, mode: "realtime", deadlineMs: 20_000, requestedAt: 0,
};
const text = userText(req);
console.log(`prompt: ${SYSTEM.length + text.length} chars`);
const client = new BedrockRuntimeClient({ region: Bun.env.AWS_REGION ?? "us-east-1" });
const res = await client.send(new ConverseCommand({
  modelId,
  system: [{ text: SYSTEM }],
  messages: [{ role: "user", content: [{ text: text + "\n\nAlso, in the tool call reason field, quote the exact text of option_34." }] }],
  toolConfig: {
    tools: [{ toolSpec: { name: "choose_placement", description: "Report the chosen landing spot.", inputSchema: { json: { ...choiceSchema(req), properties: { ...choiceSchema(req).properties, reason: { type: "string" } }, additionalProperties: false } } } }],
    toolChoice: { tool: { name: "choose_placement" } },
  },
  inferenceConfig: { maxTokens: 1024 },
}));
console.log("usage:", JSON.stringify(res.usage));
console.log("answer:", JSON.stringify(res.output?.message?.content?.find((c) => c.toolUse)?.toolUse?.input));
