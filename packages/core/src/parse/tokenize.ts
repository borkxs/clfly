import yargsParser from "yargs-parser";
import type { FlagInfo } from "../types.js";

export interface TokenizeResult {
  flags: Record<string, unknown>;
  positionals: string[];
  raw: Record<string, unknown>;
}

/**
 * Tokenize argv with yargs-parser. Schema owns types/defaults; we only teach
 * the tokenizer which keys are booleans / aliases so `--no-flag` and `-x` work.
 */
export function tokenize(argv: string[], flags: FlagInfo[]): TokenizeResult {
  const boolean = flags.filter((f) => f.type === "boolean").map((f) => f.name);
  // yargs-parser: object keys are canonical names; values are aliases.
  const alias: Record<string, string> = {};
  for (const f of flags) {
    if (f.alias) alias[f.name] = f.alias;
  }

  const raw = yargsParser(argv, {
    boolean,
    alias,
    configuration: {
      "camel-case-expansion": false,
      "dot-notation": false,
      "duplicate-arguments-array": false,
      "halt-at-non-option": false,
      "parse-numbers": false,
      "parse-positional-numbers": false,
      "strip-aliased": true,
      "strip-dashed": false,
      "unknown-options-as-args": false,
    },
  }) as Record<string, unknown>;

  const positionals = (raw._ as Array<string | number>).map(String);
  const { _: _ignored, ...rest } = raw;
  return { flags: rest, positionals, raw };
}

/**
 * Merge path params, leftover positionals, and flags into one candidate object
 * for schema validation. Path params win over nothing; flags are keyed by name.
 */
export function mapToArgs(opts: {
  pathParams: Record<string, string>;
  positionals: string[];
  flags: Record<string, unknown>;
  /** Ordered names of path-param keys (from `[segment]` dirs). */
  pathParamNames: string[];
}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...opts.flags };

  for (const name of opts.pathParamNames) {
    if (opts.pathParams[name] !== undefined) {
      out[name] = opts.pathParams[name];
    }
  }

  // Extra bare tokens after the command path — expose as `_` for positionals schema
  // and also assign sequentially to any path params already filled from the path.
  if (opts.positionals.length > 0) {
    out._ = opts.positionals;
  }

  return out;
}

export function wantsHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

export function wantsVersion(argv: string[]): boolean {
  return argv.includes("--version") || argv.includes("-V");
}
