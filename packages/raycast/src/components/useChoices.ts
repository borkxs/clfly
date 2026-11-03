import { completeFromArgv, selectCompletions, type CompletionChoice } from "@clfly/core/complete";
import type { CompleteFrom } from "@clfly/core";
import { useCachedPromise } from "@raycast/utils";
import { execArgv } from "../lib/exec";
import type { Tree } from "../lib/model";

async function loadChoices(bin: string, argvKey: string, cfKey: string): Promise<CompletionChoice[]> {
  const res = await execArgv(bin, JSON.parse(argvKey) as string[], { timeoutMs: 60_000 });
  if (res.code !== 0) throw new Error(res.error ?? `exited ${res.code}`);
  return selectCompletions(res.json, JSON.parse(cfKey) as CompleteFrom);
}

/** Run a `completeFrom` source with `--json` and pick its choices. Cached per argv. */
export function useChoices(tree: Tree, cf: CompleteFrom | undefined, values: Record<string, unknown> = {}) {
  const argv = cf ? completeFromArgv(cf, tree.name, values) : [];
  return useCachedPromise(loadChoices, [tree.bin, JSON.stringify(argv), JSON.stringify(cf ?? {})], {
    execute: cf !== undefined,
    keepPreviousData: true,
  });
}
