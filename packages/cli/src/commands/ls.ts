import { z } from "zod";
import type { Context } from "@clfly/core";
import { formatLs, runLs } from "../registry/link.js";

export const meta = {
  description: "List linked trees, whether their bins resolve, and where they are registered",
};

export const args = z.object({
  prune: z
    .boolean()
    .default(false)
    .describe("Delete entries whose package directory is gone"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const { rows, pruned } = runLs({ env: ctx.env, prune: opts.prune });
  if (!ctx.json) {
    ctx.stdout.write(formatLs(rows));
    for (const name of pruned) ctx.stdout.write(`Pruned ${name}\n`);
  }
  return { rows, pruned };
}
