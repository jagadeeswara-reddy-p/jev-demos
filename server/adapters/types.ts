import type { AgentKind, DecisionAnswer, DecisionRequest } from "../../src/arena/types";
import type { Env } from "../models/env";
import type { ModelConfig } from "../models/types";

// An adapter turns one Tetris decision into one API call and the reply into an
// answer. The arena never sees a provider's wire format: adding a provider that
// speaks a new protocol means adding one file that implements this.

export interface Adapter {
  /** How boards driven by this adapter are classed in the results. */
  kind: AgentKind;
  /** Used when a model doesn't set timeoutMs. */
  defaultTimeoutMs: number;
  /** Why a model can't run beyond unset ${ENV} placeholders (e.g. no AWS credentials), or undefined. */
  unavailable?(model: ModelConfig, env: Env): string | undefined;
  /** One decision. Must honour `signal`; throwing counts as an error answer. */
  decide(model: ModelConfig, req: DecisionRequest, signal: AbortSignal): Promise<DecisionAnswer>;
}
