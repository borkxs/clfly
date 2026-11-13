import { ClflyError } from "@clfly/core";
import { z } from "zod";

/** A command's arguments object: an object over MCP, a JSON string on the CLI. */
export const inputObject = z.preprocess((v) => (typeof v === "string" ? JSON.parse(v) : v), z.record(z.string(), z.unknown()));
import { pooledClient } from "./client.js";
import { type HubIndex, loadIndex, resolveTool, unwrapCall } from "./hub.js";

let memo: { at: number; index: HubIndex } | undefined;

/** The hub index, kept in memory for a minute so a burst of calls stats the trees once. */
export async function hubIndex(env: NodeJS.ProcessEnv, refresh = false): Promise<HubIndex> {
  if (!refresh && memo && Date.now() - memo.at < 60_000) return memo.index;
  memo = { at: Date.now(), index: await loadIndex({ env, refresh }) };
  return memo.index;
}

/** Run one tree command through its own MCP server. `destructive` must be true for commands marked destructive. */
export async function callTreeTool(input: {
  tool: string;
  input: Record<string, unknown>;
  destructive: boolean;
  env: NodeJS.ProcessEnv;
  cwd: string;
}): Promise<unknown> {
  const index = await hubIndex(input.env);
  const { tree, tool, known } = resolveTool(index, input.tool);
  if (known?.destructive && !input.destructive) {
    throw new ClflyError(`${tree.name} ${tool.replace(/_/g, " ")} is marked destructive: run it with call-destructive`, 2);
  }
  if (!tree.bin) throw new ClflyError(`${tree.name} is not on PATH`, 1);
  const client = pooledClient(tree.name, tree.bin, input.cwd, input.env);
  return unwrapCall(`${tree.name} ${tool}`, await client.callTool(tool, input.input));
}
