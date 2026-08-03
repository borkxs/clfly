import { ClflyError } from "../errors.js";

/** Internal placeholder so yargs-parser does not treat `-` as a bare positional. */
export const BIND_SENTINEL = "\0clfly-bind\0";

export type AssembleOk = { ok: true; args: Record<string, unknown> };
export type AssembleErr = { ok: false; message: string };
export type AssembleResult = AssembleOk | AssembleErr;

export interface AssembleInputOptions {
  /** Argv-derived candidate (flags, path params, positionals) before stdin overlay. */
  argvArgs: Record<string, unknown>;
  /** Raw stdin text (may be empty). Ignored when `stdinIsTTY` or trim-empty. */
  stdinText: string | undefined;
  /** True when stdin is a TTY — stdin is ignored. */
  stdinIsTTY: boolean;
  /** Declared top-level keys of the args schema (unknown stdin keys dropped). */
  declaredKeys: ReadonlySet<string>;
  /**
   * Field name receiving a `-` bind, if exactly one sentinel was present.
   * When set, merge is disabled and the entire decoded JSON is assigned here.
   */
  bindField?: string;
}

/**
 * Decode / merge / bind stdin into the argv candidate object.
 * Pure and fixture-testable — does not apply schema defaults (validator does).
 */
export function assembleInput(opts: AssembleInputOptions): AssembleResult {
  const shouldRead =
    !opts.stdinIsTTY &&
    opts.stdinText !== undefined &&
    opts.stdinText.trim() !== "";

  if (opts.bindField) {
    if (!shouldRead) {
      return {
        ok: false,
        message: "Bind sentinel `-` requires non-empty non-TTY stdin JSON",
      };
    }
    const decoded = decodeSingleJson(opts.stdinText!);
    if (!decoded.ok) return decoded;
    // Bind disables merge: argv keys stay, then overwrite bind field with full value.
    const args: Record<string, unknown> = { ...opts.argvArgs };
    delete args[BIND_SENTINEL];
    // Replace sentinel placeholder if still present under the bind field.
    args[opts.bindField] = decoded.value;
    return { ok: true, args };
  }

  if (!shouldRead) {
    return { ok: true, args: { ...opts.argvArgs } };
  }

  const decoded = decodeSingleJson(opts.stdinText!);
  if (!decoded.ok) return decoded;

  if (
    decoded.value === null ||
    typeof decoded.value !== "object" ||
    Array.isArray(decoded.value)
  ) {
    return {
      ok: false,
      message:
        "Stdin in merge mode must be a single JSON object (use `-` to bind arrays)",
    };
  }

  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(decoded.value as Record<string, unknown>)) {
    if (opts.declaredKeys.has(k)) filtered[k] = v;
  }

  // Stdin first, argv wins on conflict (shallow).
  return { ok: true, args: { ...filtered, ...opts.argvArgs } };
}

/**
 * Decode exactly one JSON value. Multi-value / NDJSON → error.
 */
export function decodeSingleJson(
  text: string,
): { ok: true; value: unknown } | AssembleErr {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, message: "Stdin is empty" };
  }

  let value: unknown;
  let end = -1;
  try {
    // Prefer JSON.parse of the whole string when it is one value.
    value = JSON.parse(trimmed);
    // If parse succeeded on the full trim, ensure no trailing second value
    // by checking that we didn't silently accept only a prefix — JSON.parse
    // rejects trailing junk, so NDJSON fails here. Good.
    return { ok: true, value };
  } catch {
    // Fall through to stream decode for a clearer multi-value path, or
    // confirm it is simply invalid JSON.
  }

  // NDJSON / concatenated: try parsing first line then detect remainder.
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length > 1) {
    try {
      JSON.parse(lines[0]!);
      // First line is JSON and more lines exist → multi-value.
      return {
        ok: false,
        message:
          "Stdin contains multiple JSON values (NDJSON); pass one document or use bind",
      };
    } catch {
      /* invalid JSON overall */
    }
  }

  // Concatenated values without newlines: walk with JSON.parse slice.
  const multi = tryDetectMultipleJsonValues(trimmed);
  if (multi === "multi") {
    return {
      ok: false,
      message:
        "Stdin contains multiple JSON values; pass one document or use bind",
    };
  }

  return { ok: false, message: "Invalid JSON on stdin" };
}

function tryDetectMultipleJsonValues(text: string): "multi" | "invalid" | "one" {
  // Use a simple scanner: parse from index 0, if leftover non-whitespace → multi or junk.
  try {
    // JSON.parse already rejects trailing junk — so "one" is the normal path.
    JSON.parse(text);
    return "one";
  } catch {
    // Try first value via manual brace matching for objects/arrays.
  }
  let i = 0;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  if (i >= text.length) return "invalid";

  const start = i;
  const ch = text[i]!;
  if (ch === "{" || ch === "[") {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (; i < text.length; i++) {
      const c = text[i]!;
      if (inString) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    try {
      JSON.parse(text.slice(start, i));
    } catch {
      return "invalid";
    }
    while (i < text.length && /\s/.test(text[i]!)) i++;
    if (i < text.length) return "multi";
    return "one";
  }

  // Primitive first value — find end via JSON.parse incremental (hard); treat as invalid.
  return "invalid";
}

/**
 * Rewrite standalone `-` flag/positional values to {@link BIND_SENTINEL} so
 * yargs-parser does not steal them as bare `_` tokens.
 *
 * Returns the rewritten argv and the list of bound field names discovered
 * from `--flag -` / `--flag=-` forms. Bare positional `-` is rewritten but
 * field assignment is left to the caller (via positionals).
 */
export function rewriteBindSentinels(argv: string[]): {
  argv: string[];
  /** Flag names that used `--name -` or `--name=-`. */
  flagBindFields: string[];
  /** Count of bare positional `-` tokens rewritten. */
  positionalBindCount: number;
} {
  const out: string[] = [];
  const flagBindFields: string[] = [];
  let positionalBindCount = 0;

  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;

    if (t.startsWith("--") && t.includes("=")) {
      const eq = t.indexOf("=");
      const name = t.slice(2, eq);
      const value = t.slice(eq + 1);
      if (value === "-") {
        flagBindFields.push(name);
        out.push(`--${name}=${BIND_SENTINEL}`);
      } else {
        out.push(t);
      }
      continue;
    }

    if (t === "-") {
      const prev = out[out.length - 1];
      if (
        prev &&
        prev.startsWith("-") &&
        prev !== "--" &&
        !prev.includes("=") &&
        prev !== BIND_SENTINEL
      ) {
        // `--flag -` or `-a -` (short alias as previous token alone is rare).
        const name = prev.startsWith("--") ? prev.slice(2) : prev.slice(1);
        flagBindFields.push(name);
        out.push(BIND_SENTINEL);
      } else {
        positionalBindCount++;
        out.push(BIND_SENTINEL);
      }
      continue;
    }

    out.push(t);
  }

  return { argv: out, flagBindFields, positionalBindCount };
}

/** Count bind sentinels and resolve the single bind field name from argvArgs. */
export function resolveBindField(
  argvArgs: Record<string, unknown>,
  flagBindFields: string[],
  positionalBindCount: number,
): { ok: true; bindField?: string } | AssembleErr {
  const total = flagBindFields.length + positionalBindCount;
  if (total > 1) {
    return {
      ok: false,
      message: "Only one `-` bind sentinel is allowed per invocation",
    };
  }
  if (total === 0) return { ok: true };

  if (flagBindFields.length === 1) {
    return { ok: true, bindField: flagBindFields[0] };
  }

  // Positional bind: find which key still holds the sentinel after rest assignment.
  for (const [k, v] of Object.entries(argvArgs)) {
    if (v === BIND_SENTINEL) return { ok: true, bindField: k };
  }
  return {
    ok: false,
    message: "Bind sentinel `-` did not map to a declared argument",
  };
}

export function usageError(message: string): never {
  throw new ClflyError(message, 2);
}
