import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { ClflyError, type Context } from "@clfly/core";
import { runAdd } from "../scaffold/add.js";

export const meta = {
  description: "Add command file stubs to the commands/ tree",
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
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
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
