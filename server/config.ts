// Server settings, read once from the environment. Bun loads .env automatically.
// Models are configured in models.json and models.local.json (see server/models);
// their keys come from .env and are never sent to the browser.

const env = Bun.env;

function num(name: string, fallback: number): number {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${v}"`);
  return n;
}

export const config = {
  port: num("PORT", 5317),
  /** 127.0.0.1 keeps the page (which can run models on your keys) off the network; set HOST=0.0.0.0 to share it. */
  host: env.HOST || "127.0.0.1",
  runsDir: env.RUNS_DIR ?? "runs",
  production: env.NODE_ENV === "production",
  /** Built-in models (committed). */
  modelsFile: env.MODELS_FILE ?? "models.json",
  /** Models added in the page and the saved line-up (git-ignored; holds keys). */
  localModelsFile: env.LOCAL_MODELS_FILE ?? "models.local.json",
  /** The live line-up until one is picked in the page, as model ids, left to right. */
  lineup: (env.LINEUP ?? "live-jev,live-llm")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
