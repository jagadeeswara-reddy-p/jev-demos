// ${NAME} placeholders in model settings, filled from the environment. This is
// how models.json refers to keys and addresses without containing them.
//   ${NAME}           required: the model is unavailable while NAME is unset or empty
//   ${NAME:-default}  optional: uses `default` when NAME is unset or empty; the default
//                     may be empty or hold placeholders of its own (only looked at then)
// Values from the environment are used as they are; a "${" inside one is not expanded.

export type Env = Record<string, string | undefined>;

/**
 * Fills every placeholder in the strings of `value` (nested objects and arrays too).
 * Required variables that are unset are listed in `missing`, in order, without duplicates.
 */
export function fillEnv<T>(value: T, env: Env): { value: T; missing: string[] } {
  const missing = new Set<string>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return fill(v, env, missing);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, missing: [...missing] };
}

const NAME = /^[A-Z0-9_]+/;

function fill(text: string, env: Env, missing: Set<string>): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("${", i);
    if (start < 0) break;
    const name = NAME.exec(text.slice(start + 2))?.[0];
    const after = start + 2 + (name?.length ?? 0);
    const close = name ? closingBrace(text, after) : -1;
    if (!name || close < 0 || (text[after] !== "}" && !text.startsWith(":-", after))) {
      // Not a placeholder ("${" followed by something else): keep it as written.
      out += text.slice(i, start + 2);
      i = start + 2;
      continue;
    }
    out += text.slice(i, start);
    const found = env[name];
    if (found) out += found;
    else if (text[after] === "}") missing.add(name);
    else out += fill(text.slice(after + 2, close), env, missing);
    i = close + 1;
  }
  return out + text.slice(i);
}

/** Index of the "}" that closes a placeholder whose name ends at `from`, allowing nested ${...}. */
function closingBrace(text: string, from: number): number {
  let depth = 1;
  for (let j = from; j < text.length; j++) {
    if (text.startsWith("${", j)) {
      depth++;
      j++;
    } else if (text[j] === "}" && --depth === 0) return j;
  }
  return -1;
}
