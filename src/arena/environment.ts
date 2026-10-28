import type { Environment } from "../core/types";
import { ArenaSimulation } from "./simulation";
import type { ArenaEvent, RunConfig, TetrisTurnDetail } from "./types";

// Tetris as an environment: every board gets the same pieces on one shared
// clock, and each option comes with its consequences described.

export const tetris: Environment<RunConfig, ArenaEvent, TetrisTurnDetail> = {
  id: "tetris",
  version: "3",
  variants: ["described"],
  createMatch: (config, agents) => new ArenaSimulation(config, agents),
};
