import { describe, expect, test } from "bun:test";
import { fillEnv } from "./env";

describe("fillEnv", () => {
  const env = { KEY: "secret", HOST: "10.0.0.1", EMPTY: "" };

  test("fills required placeholders and reports unset ones", () => {
    const { value, missing } = fillEnv({ url: "http://${HOST}:8000", key: "${KEY}", other: "${NOPE}" }, env);
    expect(value).toEqual({ url: "http://10.0.0.1:8000", key: "secret", other: "" });
    expect(missing).toEqual(["NOPE"]);
  });

  test("treats an empty variable as unset", () => {
    expect(fillEnv("${EMPTY}", env).missing).toEqual(["EMPTY"]);
    expect(fillEnv("${EMPTY:-fallback}", env).value).toBe("fallback");
  });

  test("uses defaults, including empty and nested ones, only when needed", () => {
    expect(fillEnv("${NOPE:-}", env)).toEqual({ value: "", missing: [] });
    expect(fillEnv("${NOPE:-${HOST}}", env).value).toBe("10.0.0.1");
    expect(fillEnv("${NOPE:-${ALSO_NOPE:-deep}}", env).value).toBe("deep");
    // The default isn't looked at when the variable is set, so its own placeholders don't count as missing.
    expect(fillEnv("${KEY:-${NOPE}}", env)).toEqual({ value: "secret", missing: [] });
  });

  test("walks nested objects and arrays, leaving other values alone", () => {
    const { value } = fillEnv({ a: ["${KEY}", 3, true], b: { c: "${HOST}", d: null } }, env);
    expect(value).toEqual({ a: ["secret", 3, true], b: { c: "10.0.0.1", d: null } });
  });

  test("leaves text that isn't a placeholder as written", () => {
    expect(fillEnv("${lower} and ${UNCLOSED", env).value).toBe("${lower} and ${UNCLOSED");
    expect(fillEnv("$${KEY}", env).value).toBe("$secret");
  });

  test("never expands placeholders inside environment values", () => {
    expect(fillEnv("${A}", { A: "${KEY}", KEY: "secret" }).value).toBe("${KEY}");
  });

  test("lists each missing variable once", () => {
    expect(fillEnv(["${X}", "${X}", "${Y}"], {}).missing).toEqual(["X", "Y"]);
  });
});
