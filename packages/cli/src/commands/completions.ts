import { z } from "zod";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CompletionShell, Context, Manifest } from "@clfly/core";
import { buildManifest, generateCompletions } from "@clfly/core";

export const meta = {
  description: "Generate shell completions from the command tree",
};

export const args = z.object({
  shell: z
    .enum(["bash", "zsh", "fish"])
    .describe("Shell to generate completions for"),
  name: z.string().default("cli").describe("CLI binary name in the script"),
  dir: z.string().default("commands").describe("Commands directory"),
  manifest: z.string().optional().describe("Existing manifest module to use"),
  out: z.string().optional().describe("Write script to this file (default: stdout)"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const manifest = await loadOrBuildManifest(opts, ctx.cwd);
  const script = generateCompletions({
    name: opts.name,
    manifest,
    shell: opts.shell as CompletionShell,
  });
  if (opts.out) {
    const out = resolve(ctx.cwd, opts.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, script, "utf8");
    if (!ctx.json) ctx.stdout.write(`Wrote ${opts.shell} completions to ${out}\n`);
    return { outFile: out, shell: opts.shell };
  }
  if (!ctx.json) ctx.stdout.write(script);
  return { shell: opts.shell, script };
}

async function loadOrBuildManifest(
  opts: z.infer<typeof args>,
  cwd: string,
): Promise<Manifest> {
  if (opts.manifest) {
    const mod = await import(pathToFileURL(resolve(cwd, opts.manifest)).href);
    return (mod.manifest ?? mod.default) as Manifest;
  }
  const result = await buildManifest({
    commandsDir: resolve(cwd, opts.dir),
    outFile: resolve(cwd, ".clfly/manifest.js"),
  });
  return result.manifest;
}
