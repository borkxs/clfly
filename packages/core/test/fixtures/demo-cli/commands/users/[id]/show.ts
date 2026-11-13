import { z } from "zod";
import type { Context } from "@clfly/core";

export const meta = {
  description: "Show a single user",
};

export const args = z.object({
  id: z.string().describe("User id"),
});

export default async function (
  opts: z.infer<typeof args>,
  ctx: Context,
) {
  const user = { id: opts.id, status: "active" };
  if (ctx.json) return user;
  ctx.stdout.write(`${user.id}\t${user.status}\n`);
}
