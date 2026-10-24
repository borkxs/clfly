import { resolve } from "node:path";
import { z } from "zod";
import type { Context } from "@clfly/core";
import { exportSkill } from "../../skill/export.js";

export const meta = {
  description: "Write a SKILL.md generated from this tree's command manifest",
};

export const args = z.object({
  out: z
    .string()
    .optional()
    .describe("Directory to write SKILL.md into (default: <repo>/.claude/skills/<tree>)"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const dest = await exportSkill({
    cwd: ctx.cwd,
    outDir: opts.out ? resolve(ctx.cwd, opts.out) : undefined,
  });
  if (!ctx.json) {
    ctx.stdout.write(`${dest}\n`);
  }
  return { outFile: dest };
}
