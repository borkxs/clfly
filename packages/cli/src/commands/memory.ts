import { resolve } from "node:path";
import { z } from "zod";
import type { Context } from "@clfly/core";
import { writeMemory } from "../skill/memory.js";

export const meta = {
  description:
    "Write a Claude Code memory file listing every linked tree and its commands (rewrites only on change)",
};

export const args = z.object({
  out: z.string().describe("Memory file to write, e.g. ~/.claude/projects/<proj>/memory/clfly-trees.md"),
  name: z.string().default("clfly-trees").describe("Memory name in the frontmatter"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const out = opts.out.startsWith("~/") ? resolve(ctx.env.HOME ?? "", opts.out.slice(2)) : resolve(ctx.cwd, opts.out);
  const result = await writeMemory({ env: ctx.env, outFile: out, name: opts.name });
  if (!ctx.json) {
    ctx.stdout.write(`${result.changed ? "Wrote" : "Unchanged"} ${result.outFile} (${result.trees.length} trees)\n`);
  }
  return result;
}
