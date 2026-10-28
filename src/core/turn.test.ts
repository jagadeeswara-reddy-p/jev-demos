import { describe, expect, test } from "bun:test";
import { observationText } from "./turn";
import type { Turn } from "./types";

const turn = (texts: string[]): Turn => ({
  id: "t",
  instructions: "",
  observation: texts.map((text) => ({ type: "text", text })),
  action: { kind: "choice", options: [] },
  deadlineMs: 0,
  requestedAt: 0,
  detail: null,
});

describe("observationText", () => {
  test("joins text parts with a blank line", () => {
    expect(observationText(turn(["a", "b"]))).toBe("a\n\nb");
    expect(observationText(turn(["a"]))).toBe("a");
  });
});
