import { expect, test } from "bun:test";
import type { ModelConfig } from "../models/types";
import { sampleTurn } from "../sample";
import { converseInput } from "./bedrock";
import { completionBody } from "./completion";
import { decisionBody } from "./decision";

// What each adapter sends must stay byte for byte the same across refactors.
// UPDATE_GOLDEN=1 rewrites the fixture; only do that for a deliberate prompt change.

const FIXTURE = `${import.meta.dir}/__golden__/bodies.json`;
const chat: ModelConfig = { id: "c", label: "Chat", adapter: "completion", model: "fake" };
const decision: ModelConfig = { id: "d", label: "Decision", adapter: "decision", model: "fake" };
const bedrock: ModelConfig = { id: "b", label: "Bedrock", adapter: "bedrock", model: "fake" };

test("adapter requests match the golden bodies", async () => {
  const actual: Record<string, unknown> = {};
  for (const seed of [1, 2]) {
    const req = sampleTurn(seed);
    actual[`completion-schema-seed${seed}`] = completionBody({ ...chat, jsonMode: "schema" }, req);
    actual[`completion-object-seed${seed}`] = completionBody({ ...chat, jsonMode: "object" }, req);
    actual[`decision-rot1-seed${seed}`] = decisionBody(decision, req);
    actual[`decision-rot4-seed${seed}`] = decisionBody({ ...decision, rotations: 4 }, req);
    actual[`bedrock-forced-seed${seed}`] = converseInput(bedrock, req);
    actual[`bedrock-auto-seed${seed}`] = converseInput({ ...bedrock, toolChoice: "auto" }, req);
  }
  const json = JSON.parse(JSON.stringify(actual));
  if (Bun.env.UPDATE_GOLDEN === "1") await Bun.write(FIXTURE, `${JSON.stringify(json, null, 2)}\n`);
  expect(JSON.stringify(json)).toBe(JSON.stringify(await Bun.file(FIXTURE).json()));
});
