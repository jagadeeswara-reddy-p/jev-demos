import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
});

describe("bench doctor", () => {
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

describe("bench usage", () => {
  test("an unknown command prints usage and exits 1", async () => {
    const { io, text } = capture();
    expect(await main(["fly"], io)).toBe(1);
    expect(text()).toContain("bun bench init");
  });

  test("no command prints usage and exits 0", async () => {
    const { io, text } = capture();
    expect(await main([], io)).toBe(0);
    expect(text()).toContain("bun bench run");
  });
});
