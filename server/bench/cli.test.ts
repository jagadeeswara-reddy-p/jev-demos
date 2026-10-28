import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMO, type Io, main } from "./cli";

const EXAMPLE = join(import.meta.dir, "../../bench.example.yaml");

function capture(confirmAnswer = true) {
  const lines: string[] = [];
  const io: Io = {
    out: (text) => lines.push(text),
    confirm: async () => confirmAnswer,
  };
  return { io, text: () => lines.join("\n") };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "bench-cli-"));
}

function benchFile(dir: string, models: string): string {
  const file = join(dir, "bench.yaml");
  writeFileSync(file, `name: cli-test\nmodels:\n${models}\n`);
  return file;
}

describe("bench init", () => {
  test("writes bench.yaml from the example, refuses to overwrite, and --force replaces it", async () => {
    const dir = tempDir();
    const file = join(dir, "bench.yaml");
    const first = capture();
    expect(await main(["init", file], first.io)).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(readFileSync(EXAMPLE, "utf8"));
    expect(existsSync(join(dir, ".env"))).toBe(true);
    expect(first.text()).toContain("bun bench doctor");

    writeFileSync(file, "name: mine\n");
    const second = capture();
    expect(await main(["init", file], second.io)).toBe(1);
    expect(readFileSync(file, "utf8")).toBe("name: mine\n");

    expect(await main(["init", file, "--force"], capture().io)).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(readFileSync(EXAMPLE, "utf8"));
  });

  test("the .env it creates is readable by its owner only", async () => {
    const dir = tempDir();
    expect(await main(["init", join(dir, "bench.yaml")], capture().io)).toBe(0);
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);
  });
});

describe("bench doctor", () => {
  test("the example bench passes doctor with no keys set", async () => {
    const dir = tempDir();
    const file = join(dir, "bench.yaml");
    expect(await main(["init", file], capture().io)).toBe(0);
    const { io, text } = capture();
    expect(await main(["doctor", file], { ...io, env: {} })).toBe(0);
    expect(text()).not.toContain("Set ");
  });

  test("a missing bench file names init and exits 1, without a stack trace", async () => {
    const file = join(tempDir(), "nope.yaml");
    const { io, text } = capture();
    expect(await main(["doctor", file], io)).toBe(1);
    expect(text()).toContain(`No ${file} found.`);
    expect(text()).toContain("bun bench init");
    expect(text()).toContain("bun bench doctor path/to/bench.yaml");
  });

  test("an unset key fails the check and names the variable; mocks say they make no calls", async () => {
    const dir = tempDir();
    const file = benchFile(
      dir,
      `  - id: keyed
    label: Keyed
    adapter: completion
    baseUrl: http://localhost:5400/v1
    model: fake
    apiKey: "\${BENCH_TEST_UNSET_KEY}"
  - heuristic`,
    );
    const { io, text } = capture();
    expect(await main(["doctor", file], io)).toBe(1);
    expect(text()).toContain("BENCH_TEST_UNSET_KEY");
    expect(text()).toContain("mock, no API calls");
  });

  test("a literal apiKey is refused at load time, naming the field", async () => {
    const dir = tempDir();
    const file = benchFile(
      dir,
      `  - id: literal
    label: Literal
    adapter: completion
    baseUrl: http://localhost:5400/v1
    model: fake
    apiKey: "sk-123"`,
    );
    const { io, text } = capture();
    expect(await main(["doctor", file], io)).toBe(1);
    expect(text()).toContain("models[0].apiKey");
  });
});

describe("bench run", () => {
  test("a missing bench file names the run command and exits 1", async () => {
    const file = join(tempDir(), "nope.yaml");
    const { io, text } = capture();
    expect(await main(["run", file], io)).toBe(1);
    expect(text()).toContain("bun bench run path/to/bench.yaml");
  });

  test("refuses to start when a check fails, and writes nothing", async () => {
    const dir = tempDir();
    const file = benchFile(
      dir,
      `  - id: keyed
    label: Keyed
    adapter: completion
    baseUrl: http://localhost:5400/v1
    model: fake
    apiKey: "\${BENCH_TEST_UNSET_KEY}"`,
    );
    const out = join(dir, "out");
    const { io, text } = capture();
    expect(await main(["run", file, "--yes", "--out", out], io)).toBe(1);
    expect(text()).toContain("BENCH_TEST_UNSET_KEY");
    expect(existsSync(out)).toBe(false);
  });
});

describe("bench run confirmation", () => {
  // A live model on a local server: wall pace, so run asks before it starts.
  function liveBench(dir: string, port: number): string {
    const file = join(dir, "bench.yaml");
    writeFileSync(
      file,
      `name: confirm-test
seeds: 1
clocks:
  - frozen
tetris:
  maxDurationMs: 10000
  maxPieces: 3
models:
  - id: local
    label: Local
    adapter: completion
    baseUrl: http://localhost:${port}/v1
    model: fake
`,
    );
    return file;
  }

  function fakeServer() {
    return Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          choices: [{ message: { content: '{"choice":"option_1"}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
    });
  }

  function portOf(server: { port?: number }): number {
    if (server.port === undefined) throw new Error("the fake server has no port");
    return server.port;
  }

  function spyIo(answer: boolean) {
    const lines: string[] = [];
    let asked = 0;
    const io: Io = {
      out: (text) => lines.push(text),
      confirm: async () => {
        asked++;
        return answer;
      },
    };
    return { io, text: () => lines.join("\n"), asked: () => asked };
  }

  test("a no at the confirmation stops the run before any match is played", async () => {
    const server = fakeServer();
    try {
      const dir = tempDir();
      const file = liveBench(dir, portOf(server));
      const out = join(dir, "out");
      const spy = spyIo(false);
      expect(await main(["run", file, "--out", out], spy.io)).toBe(0);
      expect(spy.asked()).toBe(1);
      expect(spy.text()).toContain("Not started.");
      const files = existsSync(out) ? readdirSync(out) : [];
      expect(files.filter((f) => f.endsWith(".jsonl"))).toEqual([]);
      expect(files).not.toContain("bench.json");
    } finally {
      server.stop(true);
    }
  });

  test("--yes skips the confirmation and plays the bench", async () => {
    const server = fakeServer();
    try {
      const dir = tempDir();
      const file = liveBench(dir, portOf(server));
      const out = join(dir, "out");
      const spy = spyIo(false);
      expect(await main(["run", file, "--yes", "--out", out], spy.io)).toBe(0);
      expect(spy.asked()).toBe(0);
      expect(existsSync(join(out, "bench.json"))).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});

describe("bench demo", () => {
  test("plays the demo matches with mocks and writes the manifest and logs", async () => {
    const dir = tempDir();
    const { io, text } = capture();
    const code = await main(["demo", "--out", dir], io, { ...DEMO, maxPieces: 30 });
    expect(code).toBe(0);
    expect(text()).toContain("[1/2]");
    expect(text()).toContain("[2/2]");
    expect(text()).toContain(`Next: bun bench init`);
    const manifest = JSON.parse(readFileSync(join(dir, "bench.json"), "utf8"));
    expect(manifest.matches).toHaveLength(2);
    const logs = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    expect(logs).toHaveLength(2);
  });
});

describe("bench demo resume", () => {
  test("a second demo into the same folder with another stopWhenFinished prints the reason and exits 1", async () => {
    const dir = tempDir();
    expect(await main(["demo", "--out", dir], capture().io, { ...DEMO, maxPieces: 30 })).toBe(0);
    const { io, text } = capture();
    expect(await main(["demo", "--out", dir], io, { ...DEMO, maxPieces: 30, stopWhenFinished: 0.5 })).toBe(1);
    expect(text()).toContain(`${dir} was run with stopWhenFinished 0.75; use --out <new folder> or delete it`);
  });
});

describe("bench usage", () => {
  test("an unknown command names it on its own line, before the usage, and exits 1", async () => {
    const { io, text } = capture();
    expect(await main(["fly"], io)).toBe(1);
    expect(text().startsWith('Unknown command "fly".\n')).toBe(true);
    expect(text()).toContain("bun bench init");
  });

  test("no command prints usage and exits 0", async () => {
    const { io, text } = capture();
    expect(await main([], io)).toBe(0);
    expect(text()).toContain("bun bench run");
  });
});

describe("bench chart", () => {
  const demoOpts = { ...DEMO, maxPieces: 30 };

  test("refuses a bench whose models are all mocks unless --allow-mock is given", async () => {
    const tmp = tempDir();
    expect(await main(["demo", "--out", tmp], capture().io, demoOpts)).toBe(0);
    const out = join(tempDir(), "media/results");
    const { io, text } = capture();
    expect(await main(["chart", tmp, "--out", out], io)).toBe(1);
    expect(text()).toContain("--allow-mock");
    expect(existsSync(`${out}-light.svg`)).toBe(false);
  });

  test("with --allow-mock it writes both SVGs and prints the picture snippet", async () => {
    const tmp = tempDir();
    expect(await main(["demo", "--out", tmp], capture().io, demoOpts)).toBe(0);
    const out = join(tempDir(), "media/results");
    const { io, text } = capture();
    expect(await main(["chart", tmp, "--out", out, "--allow-mock"], io)).toBe(0);
    for (const theme of ["light", "dark"]) {
      const svg = readFileSync(`${out}-${theme}.svg`, "utf8");
      expect(svg.startsWith("<svg")).toBe(true);
    }
    expect(text()).toContain("<picture>");
    expect(text()).toContain("srcset=");
  });

  test("a missing folder prints the reason and exits 1", async () => {
    const missing = join(tempDir(), "nope");
    const { io, text } = capture();
    expect(await main(["chart", missing, "--allow-mock"], io)).toBe(1);
    expect(text()).toContain(missing);
  });

  test("the usage text lists chart", async () => {
    const { io, text } = capture();
    expect(await main([], io)).toBe(0);
    expect(text()).toContain("bun bench chart");
  });
});
