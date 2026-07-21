import { z } from "zod";
import type { Context } from "@clfly/core";

export const meta = {
  description: "List users in the workspace",
};

export const args = z.object({
  status: z
    .enum(["active", "churned"])
    .optional()
    .describe("Filter by status"),
  limit: z.coerce.number().default(50).describe("Max rows"),
  json: z.boolean().default(false).describe("Emit JSON"),
});

export default async function (
  opts: z.infer<typeof args>,
  ctx: Context,
) {
  const rows = [
    { id: "u_1", status: "active" },
    { id: "u_2", status: "churned" },
  ]
    .filter((r) => !opts.status || r.status === opts.status)
    .slice(0, opts.limit);

  if (opts.json) {
    ctx.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return;
  }
  for (const row of rows) {
    ctx.stdout.write(`${row.id}\t${row.status}\n`);
  }
}
