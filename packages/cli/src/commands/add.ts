import { z } from "zod";
import type { Context } from "@clfly/core";
import { runAdd } from "../scaffold/add.js";

export const meta = {
  description: "Add command file stubs to the commands/ tree",
};

export const args = z.object({
  paths: z
    .array(z.string())
    .min(1)
    .describe("Command paths (e.g. user/list user/:id/report)"),
  force: z
    .boolean()
    .default(false)
    .describe("Overwrite existing command files"),
  output: z
    .boolean()
    .default(false)
    .describe("Include an output schema stub in generated files"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  return runAdd(opts, ctx);
}
