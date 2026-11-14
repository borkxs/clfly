import { z } from "zod";
import type { Context } from "@clfly/core";
import { callTreeTool, inputObject } from "../hub/run.js";

export const meta = {
  description:
    "Run one command of any linked clfly tree (`tool` as `find` names it, e.g. `pm du`) with `input` as its arguments object; refuses commands marked destructive (use call-destructive)",
};

export const positionals = z.object({
  tool: z.string().describe("`<tree> <command>`, e.g. `pm du` or `texts-cli align agree`"),
});

export const args = z.object({
  tool: z.string().describe("`<tree> <command>`, e.g. `pm du` or `texts-cli align agree`"),
  input: inputObject.default({}).describe("The command's arguments as an object (its input schema from `find`); a JSON string on the CLI"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const result = await callTreeTool({ tool: opts.tool, input: opts.input, destructive: false, env: ctx.env, cwd: ctx.cwd });
  if (!ctx.json) ctx.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}
