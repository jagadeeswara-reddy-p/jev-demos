import type { Turn } from "./types";

/** The observation as one text, for APIs that take a single string. */
export function observationText(turn: Turn): string {
  return turn.observation.map((p) => p.text).join("\n\n");
}
