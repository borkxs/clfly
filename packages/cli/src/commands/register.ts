import { z } from "zod";
import type { Context } from "@clfly/core";
import { HARNESSES } from "../registry/harness.js";
import { runRegister } from "../registry/register.js";

export const meta = {
  description: "Write one tree's MCP server entry into an agent harness config",
};

export const args = z.object({
  harness: z.enum(HARNESSES).describe("Harness whose config gets the entry"),
  scope: z
    .enum(["project", "user"])
    .default("project")
    .describe("project writes under cwd; user writes the harness's user config"),
  tree: z
    .string()
    .optional()
    .describe("Registry name or package directory (default: cwd)"),
  name: z.string().optional().describe("Harness entry name (default: the tree name)"),
  self: z
    .boolean()
    .default(false)
    .describe("Register clfly itself so agents get clfly_add / clfly_init"),
  "dry-run": z
    .boolean()
    .default(false)
    .describe("Print the file diff and change nothing"),
  remove: z.boolean().default(false).describe("Delete the entry instead of writing it"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const result = await runRegister({
    harness: opts.harness,
    scope: opts.scope,
    project: ctx.cwd,
    tree: opts.tree,
    self: opts.self,
    name: opts.name,
    dryRun: opts["dry-run"],
    remove: opts.remove,
    env: ctx.env,
    now: new Date(),
  });
  if (!ctx.json) {
    if (result.dryRun) {
      ctx.stdout.write(result.diff || `No change to ${result.file}\n`);
    } else {
      const verb = result.action === "remove" ? "Removed" : "Registered";
      const where = result.via === "file" ? result.file : `${result.via} (${result.scope})`;
      ctx.stdout.write(`${verb} ${result.name} in ${where}\n`);
    }
  }
  return result;
}
