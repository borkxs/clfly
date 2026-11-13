import { z } from "zod";
import type { Context } from "@clfly/core";
import { uninstallHost } from "../../registry/host.js";

export const meta = {
  description: "Stop and remove a tree's shared MCP server launchd agent",
  destructive: true,
};

export const args = z.object({
  tree: z.string().optional().describe("Registry name of the hosted tree (default: clfly)"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const result = uninstallHost({ tree: opts.tree, env: ctx.env });
  if (!ctx.json) {
    ctx.stdout.write(
      `Removed ${result.plist}\nSessions registered with --http need: clfly register ${result.tree === "clfly" ? "--self" : `--tree ${result.tree}`} --harness claude-code --scope user\n`,
    );
  }
  return result;
}
