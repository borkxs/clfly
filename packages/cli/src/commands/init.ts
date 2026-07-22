import { z } from "zod";
import type { Context } from "@clfly/core";
import { runInit } from "../scaffold/init.js";

export const meta = {
  description: "Scaffold a new clfly CLI (or retrofit with --force)",
};

export const args = z.object({
  name: z.string().optional().describe("Project directory name (omit to use cwd)"),
  validator: z
    .enum(["zod", "valibot", "arktype"])
    .default("zod")
    .describe("Args validator written into the template"),
  pm: z
    .enum(["npm", "pnpm", "yarn", "bun"])
    .optional()
    .describe("Package manager for install hints (default: detect)"),
  force: z
    .boolean()
    .default(false)
    .describe("Allow non-empty targets; never overwrite existing files"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  return runInit(opts, ctx);
}
