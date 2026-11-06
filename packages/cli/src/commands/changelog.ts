import { z } from "zod";
import type { Context } from "@clfly/core";
import { formatEntries, runChangelog, spawnJson, takeSnapshot } from "../changelog/changelog.js";

export const meta = {
  description:
    "Dated, newest-first list of capability changes on this machine: skills, CHANGELOG commands, trees, MCP servers, hooks, tick jobs, dash cards",
};

export const args = z.object({
  since: z.string().default("7d").describe("Window: 7d, 12h, 2w, or a date"),
  snapshot: z
    .boolean()
    .default(false)
    .describe("Only take the snapshot (diff + event log) and print how many changes it found; for the hourly tick job"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  if (opts.snapshot) {
    const snap = takeSnapshot({ env: ctx.env, runJson: spawnJson, now: new Date() });
    const result = { baseline: snap.baseline, newEvents: snap.added.length, missing: snap.missing };
    if (!ctx.json) {
      ctx.stdout.write(
        snap.baseline
          ? "Baseline snapshot written; changes show from the next run.\n"
          : `${snap.added.length} change(s) logged${snap.missing.length ? ` (unreadable: ${snap.missing.join(", ")})` : ""}\n`,
      );
    }
    return result;
  }
  const result = runChangelog({ env: ctx.env, since: opts.since });
  if (!ctx.json) {
    ctx.stdout.write(formatEntries(result.entries));
    if (result.baseline) ctx.stdout.write("(first snapshot taken now: tree/mcp/hook/tick/dash changes show from the next run)\n");
    if (result.missing.length) ctx.stdout.write(`(unreadable this run: ${result.missing.join(", ")})\n`);
  }
  return result;
}
