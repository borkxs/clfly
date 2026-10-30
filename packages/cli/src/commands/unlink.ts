import { z } from "zod";
import type { Context } from "@clfly/core";
import { runUnlink } from "../registry/link.js";

export const meta = {
  description: "Remove a tree's bin from PATH and delete its registry entry",
};

export const args = z.object({
  name: z.string().describe("Tree name as `clfly ls` shows it"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const removed = await runUnlink({ name: opts.name, env: ctx.env });
  if (!ctx.json) {
    ctx.stdout.write(`Unlinked ${removed.name} (${removed.path})\n`);
  }
  return removed;
}
