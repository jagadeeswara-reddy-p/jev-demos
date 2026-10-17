import type { AgentSpec, DecisionSource, RunConfig, SourceInfo } from "../src/arena/types";
import { isMockSource, MOCK_SOURCES, mockSourceFor } from "../src/mock/mockSource";
import { sourceFor } from "./adapters";
import { config } from "./config";
import { HealthChecks } from "./models/health";
import { ModelStore } from "./models/store";

// Everything that can drive a board: the configured models (built-in and
// page-added, through their adapters) and the mocks, which run in the browser too.

export const models = new ModelStore({
  presetsPath: config.modelsFile,
  localPath: config.localModelsFile,
  env: Bun.env,
  defaultLineup: config.lineup,
  otherSources: MOCK_SOURCES.map((s) => s.id),
});

export const health = new HealthChecks();

/** Pings the self-hosted models whose last result is stale. Call before reading availability. */
export function refreshHealth(): Promise<void> {
  return health.refresh(models.runnable());
}

/** Every source, with the last health check applied. */
export function listSources(): SourceInfo[] {
  const live = models
    .list()
    .map((m) => health.apply(m))
    .map(({ id, label, kind, description, live, available, reason }) => ({ id, label, kind, description, live, available, reason }));
  return [...live, ...MOCK_SOURCES];
}

export function createSource(run: RunConfig, spec: AgentSpec): DecisionSource {
  if (isMockSource(spec.sourceId)) return mockSourceFor(run, spec);
  return sourceFor(models.resolve(spec.sourceId));
}
