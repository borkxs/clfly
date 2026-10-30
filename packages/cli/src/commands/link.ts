import { z } from "zod";
import type { Context } from "@clfly/core";
import { runLink } from "../registry/link.js";

export const meta = {
  description: "Put a tree's bin on PATH and record it in the clfly registry",
};

export const args = z.object({
  dir: z.string().optional().describe("Package directory (default: cwd)"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const tree = await runLink({
    dir: opts.dir ? ctx.resolvePath(opts.dir) : ctx.cwd,
    env: ctx.env,
    now: new Date(),
  });
  if (!ctx.json) {
    ctx.stdout.write(`${JSON.stringify(tree, null, 2)}\n`);
  }
  return tree;
}
