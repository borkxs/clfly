import { z } from "zod";
import { resolve } from "node:path";
import { ReportedExit, type Context } from "@clfly/core";
import { runManifest } from "../registry/manifest.js";
import { checkRows, formatProblem } from "../registry/check.js";

export const meta = {
  description:
    "Build linked trees' routes in memory (flags, positionals, completeFrom, rows/accepts) for launchers and UIs; --check links typed rows instead (an accepts type with no producer, a ref/label/sub/where field the producer's rows never have, one type with two field sets, an un-namespaced type) and exits 1 with one line per problem",
  readOnly: true,
};

export const positionals = z.object({
  name: z.string().optional().describe("Tree name as `clfly ls` shows it (default: every linked tree)"),
});

export const complete = {
  name: { cmd: "clfly ls", field: "rows[].name", sub: "path" },
};

export const args = z.object({
  name: z.string().optional().describe("Tree name as `clfly ls` shows it (default: every linked tree)"),
  commands: z
    .string()
    .optional()
    .describe("Commands directory override (default: <root>/commands, then <root>/src/commands)"),
  check: z
    .boolean()
    .default(false)
    .describe("Link typed rows across the trees: print one line per problem (tree route --arg: why) and exit 1 if any"),
  workspace: z
    .string()
    .optional()
    .describe("Use the clfly trees under <dir>/packages/* instead of the registry (CI: `--workspace .`)"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const result = await runManifest({
    env: ctx.env,
    name: opts.name,
    commandsDir: opts.commands ? resolve(ctx.cwd, opts.commands) : undefined,
    workspace: opts.workspace ? resolve(ctx.cwd, opts.workspace) : undefined,
  });
  if (opts.check) {
    const problems = checkRows(result.trees);
    for (const p of problems) ctx.stderr.write(`${formatProblem(p)}\n`);
    if (problems.length) throw new ReportedExit(1, `${problems.length} typed-rows problem(s)`);
    if (!ctx.json) ctx.stdout.write(`typed rows link: ${result.trees.length} trees, no problems\n`);
    return { trees: result.trees.map((t) => t.name), problems };
  }
  if (!ctx.json) {
    for (const tree of result.trees) {
      const status = tree.error ? `error: ${tree.error.split("\n")[0]}` : `${tree.routes.length} routes`;
      ctx.stdout.write(`${tree.name}\t${status}\n`);
    }
  }
  return result;
}
