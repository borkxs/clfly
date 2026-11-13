import { z } from "zod";
import type { Context } from "@clfly/core";
import { DEFAULT_HOST_PORT, installHost } from "../../registry/host.js";

export const meta = {
  description: "Keep one shared MCP server for a tree running on localhost (launchd), so sessions stop spawning their own",
};

export const args = z.object({
  tree: z.string().optional().describe("Registry name of the tree to host (default: clfly, the hub)"),
  port: z.coerce.number().int().default(DEFAULT_HOST_PORT).describe("Localhost port for its Streamable HTTP endpoint"),
  name: z.string().optional().describe("With --command: launchd label suffix and log name (e.g. ts-mcp)"),
  command: z
    .string()
    .optional()
    .describe("Host this command instead of a tree: an MCP server with its own HTTP mode, split on spaces, port included (e.g. \"node /abs/ts-mcp.mjs --http 4311\")"),
  cwd: z.string().optional().describe("With --command: working directory (default: the current one)"),
  "dry-run": z.boolean().default(false).describe("Print what launchd would run and change nothing"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const result = await installHost({
    tree: opts.tree,
    name: opts.name,
    command: opts.command,
    cwd: opts.cwd,
    port: opts.port,
    env: ctx.env,
    dryRun: opts["dry-run"],
  });
  if (!ctx.json) {
    const state = result.healthy === null ? "(dry run)" : result.healthy ? "up" : `NOT answering yet; see ${result.log}`;
    const point = opts.command
      ? `Point sessions at it: a type http entry for ${result.url} (see packages/ts-mcp/README.md)\n`
      : `Point sessions at it: clfly register ${result.tree === "clfly" ? "--self" : `--tree ${result.tree}`} --harness claude-code --scope user --http ${result.port}\n`;
    ctx.stdout.write(`${result.tree} on ${result.url} ${state}\n` + point);
  }
  return result;
}
