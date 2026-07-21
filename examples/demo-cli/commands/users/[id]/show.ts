import { z } from "zod";
import type { Context } from "@clfly/core";

export const meta = {
  description: "Show a single user",
};

export const args = z.object({
  id: z.string().describe("User id"),
  json: z.boolean().default(false).describe("Emit JSON"),
});

export default async function (
  opts: z.infer<typeof args>,
  ctx: Context,
) {
  const user = { id: opts.id, status: "active" };
  if (opts.json) {
    ctx.stdout.write(JSON.stringify(user, null, 2) + "\n");
    return;
  }
  ctx.stdout.write(`${user.id}\t${user.status}\n`);
}
