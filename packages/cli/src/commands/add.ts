import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { ClflyError, type Context } from "@clfly/core";
import { runAdd } from "../scaffold/add.js";

export const meta = {
  description:
    "Add command file stubs to the commands/ tree. With --summary/--arg or --spec @file, one path fans out to the command (zod args, sibling's handler shape), its test stub, a README bullet and changes/<branch>.md; prints the files written.",
};

export const args = z.object({
  paths: z
    .array(z.string())
    .min(1)
    .describe("Command paths (e.g. user/list user/:id/report)"),
  dir: z
    .string()
    .optional()
    .describe("Tree package directory to add to (default: cwd). MCP callers should pass it: the server's cwd is not the caller's."),
  force: z
    .boolean()
    .default(false)
    .describe("Overwrite existing command files"),
  output: z
    .boolean()
    .default(false)
    .describe("Include an output schema stub in generated files"),
  summary: z
    .string()
    .optional()
    .describe("One-line purpose; with it, add also writes the test stub, README bullet and changes/<branch>.md"),
  arg: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Command args, ';'-separated (or an array over MCP): name[?]:type[=default][:desc], type string|int|number|bool|string[]|enum(a|b)"),
  spec: z
    .string()
    .optional()
    .describe('@file (or inline JSON) with {"summary", "args": ["name:type=default:desc"], "readme"?}; same fan-out as --summary'),
  readme: z.string().optional().describe("README bullet text (default: the summary)"),
});

export const positionals = z.object({
  paths: z.array(z.string()).min(1).describe("Command paths (e.g. user/list user/:id/report)"),
});

export default async function (raw: z.infer<typeof args>, ctx: Context) {
  const arg = typeof raw.arg === "string" ? raw.arg.split(";").map((s) => s.trim()).filter(Boolean) : raw.arg;
  const opts = { ...raw, arg };
  if (!opts.dir) return runAdd(opts, ctx);
  const cwd = ctx.resolvePath(opts.dir);
  if (!existsSync(join(cwd, "package.json"))) {
    throw new ClflyError(`No package.json in ${cwd}; --dir must be a tree's package directory`, 2);
  }
  return runAdd(opts, {
    ...ctx,
    cwd,
    resolvePath: (p: string) => (isAbsolute(p) ? p : resolve(cwd, p)),
  });
}
