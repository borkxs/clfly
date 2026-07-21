import { z } from "zod";
import type { Context } from "@clfly/core";

export const meta = {
  description: "Deploy the current workspace",
};

export const args = z.object({
  env: z
    .enum(["staging", "production"])
    .default("staging")
    .describe("Target environment"),
  dryRun: z.boolean().default(false).describe("Print actions without applying"),
});

export default async function (
  opts: z.infer<typeof args>,
  ctx: Context,
) {
  ctx.stdout.write(
    `deploy env=${opts.env} dryRun=${opts.dryRun}\n`,
  );
}
