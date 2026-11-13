import { z } from "zod";
import type { Context } from "@clfly/core";
import { callTreeTool, inputObject } from "../hub/run.js";

export const meta = {
  description:
    "Run one clfly tree command that is marked destructive (deletes or irreversibly changes state); same arguments as call. Kept separate so it can need approval while call does not",
  destructive: true,
};

export const positionals = z.object({
  tool: z.string().describe("`<tree> <command>`, e.g. `pm rm`"),
});

export const args = z.object({
  tool: z.string().describe("`<tree> <command>`, e.g. `pm rm`"),
  input: inputObject.default({}).describe("The command's arguments as an object (its input schema from `find`); a JSON string on the CLI"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const result = await callTreeTool({ tool: opts.tool, input: opts.input, destructive: true, env: ctx.env, cwd: ctx.cwd });
  if (!ctx.json) ctx.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}
