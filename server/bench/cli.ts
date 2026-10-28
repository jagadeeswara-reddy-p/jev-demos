import { copyFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { testModel } from "../sample";
import { createSource, listSources, models, refreshHealth } from "../sources";
import { type BenchConfig, BenchConfigError, loadBench, parseBench } from "./config";
import { agentFor, type BenchEntrant, resolveEntrants } from "./entrants";
import { planMatches } from "./plan";
import { type Check, estimate, formatChecks, formatEstimate, paceFor, preflight } from "./preflight";
import { type MatchOutcome, ResumeMismatchError, runMatches, writeManifest } from "./runner";

// The `bun bench` command line: init writes the example files, doctor checks a bench
// without playing it, run plays it (after the same checks), demo plays a built-in
// bench of mock models that needs no keys.

export interface Io {
  out(text: string): void;
  confirm(question: string): Promise<boolean>;
}

const ROOT = resolve(import.meta.dir, "../..");
const EXAMPLE = join(ROOT, "bench.example.yaml");
const ENV_EXAMPLE = join(ROOT, ".env.example");
const STATS = join(ROOT, "scripts/stats.ts");

const USAGE = `Usage:
  bun bench init [file] [--force]              write bench.yaml and .env from the examples
  bun bench doctor [file]                      check every model, its key and the estimate
  bun bench run [file] [--yes] [--out dir]     play the bench (asks first when it uses live models)
  bun bench demo [--out dir]                   play the demo bench with mock models, no keys needed
The file defaults to bench.yaml. The output folder defaults to runs/bench/<name>.`;

/** The built-in bench: every mock profile, both clocks, one seed. */
export function demoConfig(overrides: Partial<BenchConfig> = {}): BenchConfig {
  const base = parseBench({
    name: "demo",
    environment: "tetris",
    seeds: [1],
    clocks: ["frozen", "realtime"],
    variants: ["described"],
    tetris: { goal: "survive", maxDurationMs: 120_000, maxPieces: 300 },
    models: ["jev", "llm-fast", "llm-frontier", "llm-flaky", "heuristic", "random"],
  });
  return { ...base, ...overrides };
}

export const DEMO: BenchConfig = demoConfig();

/** Runs one command; returns the process exit code. */
export async function main(argv: string[], io: Io, demo: BenchConfig = DEMO): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help") {
    io.out(USAGE);
    return 0;
  }
  const args = parseArgs(rest);
  if (args.error) {
    io.out(`${args.error}\n${USAGE}`);
    return 1;
  }
  switch (command) {
    case "init":
      return init(args, io);
    case "doctor":
      return doctor(args, io);
    case "run":
      return run(args, io);
    case "demo":
      return runDemo(args, io, demo);
    default:
      io.out(`Unknown command "${command}".\n${USAGE}`);
      return 1;
  }
}

interface Args {
  positional: string[];
  flags: Set<string>;
  out?: string;
  error?: string;
}

function parseArgs(rest: string[]): Args {
  const args: Args = { positional: [], flags: new Set() };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--force" || arg === "--yes") {
      args.flags.add(arg);
    } else if (arg === "--out") {
      const dir = rest[++i];
      if (dir === undefined) return { ...args, error: "--out needs a folder" };
      args.out = dir;
    } else if (arg.startsWith("--")) {
      return { ...args, error: `unknown option ${arg}` };
    } else {
      args.positional.push(arg);
    }
  }
  return args;
}

function init(args: Args, io: Io): number {
  const file = resolve(args.positional[0] ?? "bench.yaml");
  if (existsSync(file) && !args.flags.has("--force")) {
    io.out(`${file} already exists; use --force to overwrite it.`);
    return 1;
  }
  copyFileSync(EXAMPLE, file);
  io.out(`Wrote ${file}`);
  // Bun reads .env from the folder it runs in; the bench file's folder is that folder for the default file.
  const env = join(dirname(file), ".env");
  if (!existsSync(env)) {
    copyFileSync(ENV_EXAMPLE, env);
    io.out(`Wrote ${env} from .env.example`);
  }
  io.out(`Next: edit ${basename(file)}, put keys in .env, then run bun bench doctor`);
  return 0;
}

async function doctor(args: Args, io: Io): Promise<number> {
  const ins = await inspect(args.positional[0] ?? "bench.yaml", io);
  if (!ins) return 1;
  io.out(formatChecks(ins.checks));
  io.out(formatEstimate(estimate(ins.cfg, ins.entrants, ins.checks)));
  return ins.checks.every((c) => c.ok) ? 0 : 1;
}

async function run(args: Args, io: Io): Promise<number> {
  const ins = await inspect(args.positional[0] ?? "bench.yaml", io);
  if (!ins) return 1;
  io.out(formatChecks(ins.checks));
  io.out(formatEstimate(estimate(ins.cfg, ins.entrants, ins.checks)));
  const failed = ins.checks.filter((c) => !c.ok).length;
  if (failed > 0) {
    io.out(`Not started: ${failed} check${failed === 1 ? "" : "s"} failed.`);
    return 1;
  }
  if (paceFor(ins.entrants) === "wall" && !args.flags.has("--yes") && !(await io.confirm("Start?"))) {
    io.out("Not started.");
    return 0;
  }
  const paid = ins.entrants.filter((e) => e.live).map((e) => e.id);
  return play(ins.cfg, ins.entrants, args.out ?? join("runs", "bench", ins.cfg.name), io, paid);
}

async function runDemo(args: Args, io: Io, demo: BenchConfig): Promise<number> {
  const entrants = resolveEntrants(demo.models, listSources(), Bun.env);
  const outDir = args.out ?? join("runs", "bench", demo.name);
  const code = await play(demo, entrants, outDir, io, []);
  if (code !== 0) return code;
  io.out(`Output folder: ${outDir}`);
  io.out(`Replay a match: bun dev, then open the page and load a .jsonl file from ${outDir}`);
  io.out("Next: bun bench init");
  return 0;
}

interface Inspection {
  cfg: BenchConfig;
  entrants: BenchEntrant[];
  checks: Check[];
}

/** The steps doctor and run share. Prints the reason and returns null when the bench cannot be read. */
async function inspect(file: string, io: Io): Promise<Inspection | null> {
  if (!Bun.semver.satisfies(Bun.version, ">=1.4.0")) {
    io.out(`bun bench needs Bun 1.4.0 or newer; this is Bun ${Bun.version}.`);
    return null;
  }
  try {
    const cfg = await loadBench(file);
    await refreshHealth();
    const entrants = resolveEntrants(cfg.models, listSources(), Bun.env);
    const checks = await preflight(entrants, (e) => testModel(e.model ?? models.resolve(e.id)));
    return { cfg, entrants, checks };
  } catch (err) {
    if (!(err instanceof BenchConfigError)) throw err;
    // A file that cannot be read already starts with its path; validation errors do not.
    io.out(err.field === file ? err.message : `${file}: ${err.message}`);
    return null;
  }
}

/** Plays every match, writes the manifest and prints the stats of the logs. `paid` lists the live models, whose costs are real. */
async function play(cfg: BenchConfig, entrants: BenchEntrant[], outDir: string, io: Io, paid: string[]): Promise<number> {
  let outcomes: MatchOutcome[];
  try {
    outcomes = await runMatches(planMatches(cfg, entrants), {
      outDir,
      pace: paceFor(entrants),
      stopWhenFinished: cfg.stopWhenFinished,
      maxCostUsd: cfg.maxCostUsd,
      paidAgents: paid,
      agentsFor: (plan) => plan.config.agents.map((spec, i) => agentFor(entrants[i], plan.config, spec, createSource)),
      onMatch: (o, index, total) => io.out(`[${index + 1}/${total}] ${o.key}: ${o.status} (${o.unfinished.length} unfinished)`),
    });
  } catch (err) {
    if (!(err instanceof ResumeMismatchError)) throw err;
    io.out(err.message);
    return 1;
  }
  await writeManifest(outDir, cfg, outcomes);
  io.out(`Wrote ${join(outDir, "bench.json")}`);

  const logs = outcomes.filter((o) => o.status !== "skipped").map((o) => o.file);
  if (logs.length > 0) {
    const stats = Bun.spawn(["bun", STATS, ...logs], { stdout: "pipe", stderr: "inherit" });
    io.out((await new Response(stats.stdout).text()).trimEnd());
    await stats.exited;
  }
  return 0;
}

if (import.meta.main) {
  process.exit(
    await main(process.argv.slice(2), {
      out: console.log,
      confirm: async (q) => (prompt(`${q} [y/N]`) ?? "").trim().toLowerCase() === "y",
    }),
  );
}
