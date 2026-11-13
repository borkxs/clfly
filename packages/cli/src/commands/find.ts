import { z } from "zod";
import type { Context } from "@clfly/core";
import { searchIndex, toolRef } from "../hub/hub.js";
import { hubIndex } from "../hub/run.js";

export const meta = {
  description:
    "Find commands across every linked clfly tree by keywords; returns each match's `call` name, description, input schema and destructive flag",
  readOnly: true,
};

export const positionals = z.object({
  query: z.string().describe('Keywords, e.g. "premiumize transfers" or "plex scan"'),
});

export const args = z.object({
  query: z.string().describe('Keywords, e.g. "premiumize transfers" or "plex scan"'),
  limit: z.coerce.number().int().min(1).max(30).default(8).describe("Most matches to return"),
  refresh: z.boolean().default(false).describe("Re-ask every tree for its commands instead of using the cache"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  const index = await hubIndex(ctx.env, opts.refresh);
  const matches = searchIndex(index, opts.query, opts.limit).map((t) => ({
    tool: toolRef(t),
    description: t.description,
    ...(t.destructive ? { destructive: true } : {}),
    ...(t.readOnly ? { readOnly: true } : {}),
    input: t.inputSchema ?? {},
  }));
  const failed = index.trees.filter((t) => t.error).map((t) => ({ tree: t.name, error: t.error }));
  if (!ctx.json) {
    if (matches.length === 0) ctx.stdout.write(`No commands match "${opts.query}".\n`);
    for (const m of matches) ctx.stdout.write(`${m.tool}${m.destructive ? "  [destructive]" : ""} — ${m.description}\n`);
    for (const f of failed) ctx.stderr.write(`(${f.tree}: ${f.error})\n`);
  }
  return { matches, ...(failed.length ? { failed } : {}) };
}
