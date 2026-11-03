import { z } from "zod";
import { resolve } from "node:path";
import type { Context } from "@clfly/core";
import { runManifest } from "../registry/manifest.js";

export const meta = {
  description:
    "Build linked trees' routes in memory (flags, positionals, completeFrom) for launchers and UIs",
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
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const result = await runManifest({
    env: ctx.env,
    name: opts.name,
    commandsDir: opts.commands ? resolve(ctx.cwd, opts.commands) : undefined,
  });
  if (!ctx.json) {
    for (const tree of result.trees) {
      const status = tree.error ? `error: ${tree.error.split("\n")[0]}` : `${tree.routes.length} routes`;
      ctx.stdout.write(`${tree.name}\t${status}\n`);
    }
  }
  return result;
}
