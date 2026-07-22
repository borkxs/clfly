import { z } from "zod";
import { resolve } from "node:path";
import type { Context } from "@clfly/core";
import { buildManifest } from "@clfly/core";

export const meta = {
  description: "Compile commands/ into a lazy load manifest",
};

export const args = z.object({
  dir: z.string().default("commands").describe("Commands directory"),
  out: z
    .string()
    .default(".clfly/manifest.js")
    .describe("Output manifest module path"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const result = await buildManifest({
    commandsDir: resolve(ctx.cwd, opts.dir),
    outFile: resolve(ctx.cwd, opts.out),
  });
  const payload = {
    outFile: result.outFile,
    routeCount: result.routeCount,
  };
  if (!ctx.json) {
    ctx.stdout.write(`Wrote ${result.routeCount} routes to ${result.outFile}\n`);
  }
  return payload;
}
