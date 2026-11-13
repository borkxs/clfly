import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * `clfly add --spec`: one spec (summary, args, optional README bullet) fans out to every file a
 * new command needs, so the command's purpose passes through an agent's context once.
 */

export type ArgType = "string" | "int" | "number" | "bool" | "string[]" | { enum: string[] };

export interface ArgSpec {
  name: string;
  type: ArgType;
  optional?: boolean;
  default?: string | number | boolean | string[];
  desc?: string;
}

export interface CommandSpec {
  summary: string;
  args: ArgSpec[];
  /** README bullet text (default: the summary). */
  readme?: string;
}

const NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** `name[?]:type[=default][:desc]`, type one of string, int, number, bool, string[], enum(a|b). */
export function parseArgSpec(input: string): ArgSpec {
  const m = /^([a-zA-Z_][a-zA-Z0-9_]*)(\?)?:(enum\([^)]*\)|string\[\]|string|int|number|bool)(?:=([^:]*))?(?::(.*))?$/.exec(
    input.trim(),
  );
  if (!m) {
    throw new Error(
      `bad arg "${input}": want name[?]:type[=default][:desc], type string|int|number|bool|string[]|enum(a|b)`,
    );
  }
  const [, name, q, rawType, rawDefault, desc] = m;
  const type = parseType(rawType!);
  const arg: ArgSpec = { name: name!, type };
  if (q) arg.optional = true;
  if (rawDefault !== undefined) arg.default = coerceDefault(type, rawDefault, name!);
  if (desc?.trim()) arg.desc = desc.trim();
  return arg;
}

function parseType(raw: string): ArgType {
  const e = /^enum\(([^)]*)\)$/.exec(raw);
  if (e) {
    const values = e[1]!.split("|").map((s) => s.trim()).filter(Boolean);
    if (values.length === 0) throw new Error(`enum needs at least one value: ${raw}`);
    return { enum: values };
  }
  return raw as ArgType;
}

function coerceDefault(type: ArgType, raw: string, name: string): ArgSpec["default"] {
  if (typeof type === "object") {
    if (!type.enum.includes(raw)) throw new Error(`${name}: default "${raw}" is not one of ${type.enum.join("|")}`);
    return raw;
  }
  switch (type) {
    case "int":
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n) || (type === "int" && !Number.isInteger(n))) {
        throw new Error(`${name}: default "${raw}" is not ${type === "int" ? "an int" : "a number"}`);
      }
      return n;
    }
    case "bool":
      if (raw !== "true" && raw !== "false") throw new Error(`${name}: bool default must be true or false`);
      return raw === "true";
    case "string[]":
      return raw === "" ? [] : raw.split(",").map((s) => s.trim());
    default:
      return raw;
  }
}

/** A spec from `--spec` (`@file`, or inline JSON) merged with inline `--summary` / `--arg`. */
export function loadSpec(
  opts: { spec?: string; summary?: string; arg?: string[]; readme?: string },
  resolvePath: (p: string) => string,
): CommandSpec | null {
  let base: Partial<CommandSpec> & { args?: (ArgSpec | string)[] } = {};
  if (opts.spec) {
    const text = opts.spec.startsWith("@") ? readFileSync(resolvePath(opts.spec.slice(1)), "utf8") : opts.spec;
    try {
      base = JSON.parse(text) as typeof base;
    } catch (err) {
      throw new Error(`--spec is not JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const summary = opts.summary ?? base.summary;
  const args = [...(base.args ?? []), ...(opts.arg ?? [])].map((a) => (typeof a === "string" ? parseArgSpec(a) : checkArg(a)));
  if (!summary && args.length === 0 && !opts.spec) return null;
  if (!summary) throw new Error("a spec needs a summary (--summary or \"summary\" in --spec)");
  const readme = opts.readme ?? base.readme;
  return { summary, args, ...(readme ? { readme } : {}) };
}

function checkArg(a: ArgSpec): ArgSpec {
  if (!a || typeof a.name !== "string" || !NAME.test(a.name)) throw new Error(`bad arg in spec: ${JSON.stringify(a)}`);
  return a;
}

function zodFor(a: ArgSpec): string {
  const t = a.type;
  let s =
    typeof t === "object"
      ? `z.enum([${t.enum.map((v) => JSON.stringify(v)).join(", ")}])`
      : t === "int"
        ? "z.coerce.number().int()"
        : t === "number"
          ? "z.coerce.number()"
          : t === "bool"
            ? "z.boolean()"
            : t === "string[]"
              ? "z.array(z.string())"
              : "z.string()";
  if (a.default !== undefined) s += `.default(${JSON.stringify(a.default)})`;
  else if (a.optional) s += ".optional()";
  if (a.desc) s += `.describe(${JSON.stringify(a.desc)})`;
  return s;
}

/** Handler shape borrowed from a sibling command: whether it types ctx as `Context` from @clfly/core. */
export interface SiblingShape {
  contextImport: boolean;
  file?: string;
}

export function readSiblingShape(absFile: string, commandsRoot: string): SiblingShape {
  for (let dir = dirname(absFile); ; dir = dirname(dir)) {
    const sib = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && join(dir, f) !== absFile)
          .sort((a, b) => Number(a === "index.ts") - Number(b === "index.ts") || a.localeCompare(b))
      : [];
    if (sib[0]) {
      const text = readFileSync(join(dir, sib[0]), "utf8");
      return {
        contextImport: /import\s+(type\s+)?\{[^}]*\bContext\b[^}]*\}\s+from\s+"@clfly\/core"/.test(text),
        file: join(dir, sib[0]),
      };
    }
    if (dir === commandsRoot || dirname(dir) === dir || !dir.startsWith(commandsRoot)) break;
  }
  return { contextImport: false };
}

export function renderSpecCommand(spec: CommandSpec, shape: SiblingShape): string {
  const argLines = spec.args.map((a) => `  ${a.name}: ${zodFor(a)},`).join("\n");
  const ctxType = shape.contextImport ? "Context" : "{ json: boolean; stdout: { write: (s: string) => void } }";
  const imports = shape.contextImport
    ? `import type { Context } from "@clfly/core";\nimport { z } from "zod";\n`
    : `import { z } from "zod";\n`;
  return `${imports}
export const meta = {
  description: ${JSON.stringify(spec.summary)},
};

export const args = z.object({
${argLines}
});

export default async function (opts: z.infer<typeof args>, ctx: ${ctxType}) {
  const result = { ok: true as const, opts };
  if (ctx.json) return result;
  ctx.stdout.write(JSON.stringify(result) + "\\n");
}
`;
}

/** A value that satisfies each required arg without a default, so the test can call the command. */
function sampleFor(a: ArgSpec): unknown {
  const t = a.type;
  if (typeof t === "object") return t.enum[0];
  return t === "int" || t === "number" ? 1 : t === "bool" ? false : t === "string[]" ? [] : "x";
}

export function renderTestBlock(opts: {
  cmdName: string;
  importPath: string;
  spec: CommandSpec;
  alias: string;
  /** false when appending to an existing test file: vitest comes in as a namespace so names never clash. */
  standalone: boolean;
}): string {
  const required = Object.fromEntries(
    opts.spec.args.filter((a) => a.default === undefined && !a.optional).map((a) => [a.name, sampleFor(a)]),
  );
  const vt = opts.standalone ? "" : `${opts.alias}_vt.`;
  const head = opts.standalone
    ? `import { describe, expect, it } from "vitest";\n`
    : `import * as ${opts.alias}_vt from "vitest";\n`;
  return `${head}import ${opts.alias}, { args as ${opts.alias}Args } from ${JSON.stringify(opts.importPath)};

${vt}describe(${JSON.stringify(opts.cmdName)}, () => {
  ${vt}it("runs with defaults", async () => {
    const ctx = { json: true, stdout: { write: () => {} } } as unknown as Parameters<typeof ${opts.alias}>[1];
    const out = await ${opts.alias}(${opts.alias}Args.parse(${JSON.stringify(required)}), ctx);
    ${vt}expect(out).toMatchObject({ ok: true });
  });
});
`;
}

/** Insert a README bullet after the tree's command list; returns null when there is no list. */
export function insertReadmeBullet(readme: string, tree: string, bullet: string): string | null {
  const lines = readme.split("\n");
  const marker = lines.findIndex((l) => l.includes("<!-- clfly:commands -->"));
  let at = -1;
  if (marker >= 0) {
    at = marker;
    while (at + 1 < lines.length && /^\s*[-*] /.test(lines[at + 1]!)) at++;
  } else {
    const isCmd = (l: string) => l.startsWith(`- \`${tree} `) || l.startsWith(`* \`${tree} `);
    const first = lines.findIndex(isCmd);
    if (first < 0) return null;
    at = first;
    while (at + 1 < lines.length && /^[-*] /.test(lines[at + 1]!)) at++;
  }
  lines.splice(at + 1, 0, bullet);
  return lines.join("\n");
}

/** Monorepo root (has `changes/` or pnpm-workspace.yaml) above `cwd`, or null. */
export function findRepoRoot(cwd: string): string | null {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) || existsSync(join(dir, "changes"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

export function currentBranch(cwd: string, env?: NodeJS.ProcessEnv): string | null {
  if (env?.CLFLY_BRANCH) return env.CLFLY_BRANCH;
  try {
    const b = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return b && b !== "HEAD" ? b : null;
  } catch {
    return null;
  }
}

export function relImport(fromFile: string, toFile: string): string {
  let r = relative(dirname(fromFile), toFile).replace(/\\/g, "/").replace(/\.ts$/, ".js");
  if (!r.startsWith(".")) r = `./${r}`;
  return r;
}
