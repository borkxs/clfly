import { execFile } from "node:child_process";
import { moduleSurface, moduleRows } from "../rows/args.js";
import type { RowTree } from "../rows/index.js";
import type { McpToolDef } from "./project.js";

/**
 * The trees a typed-rows envelope looks for acceptors in: this server's own
 * routes (always fresh) plus every linked tree from `clfly manifest --json`
 * (spawned lazily, cached, best-effort). `CLFLY_ROWS_LINKED=0` skips the spawn.
 */
export function rowTreesProvider(
  name: string,
  tools: () => McpToolDef[],
  env: NodeJS.ProcessEnv,
): () => Promise<RowTree[]> {
  let linked: { at: number; trees: Promise<RowTree[]> } | undefined;
  return async () => {
    const own = await ownRowTree(name, tools());
    if (env.CLFLY_ROWS_LINKED === "0") return [own];
    if (!linked || Date.now() - linked.at > LINKED_TTL_MS) {
      linked = { at: Date.now(), trees: linkedRowTrees(env) };
    }
    const others = (await linked.trees).filter((t) => t.name !== name);
    return [own, ...others];
  };
}

const LINKED_TTL_MS = 60_000;
const SPAWN_TIMEOUT_MS = 10_000;

/** This server's routes as a RowTree (modules load once; they are cached by the tool defs). */
export async function ownRowTree(name: string, tools: McpToolDef[]): Promise<RowTree> {
  const routes: RowTree["routes"] = [];
  for (const tool of tools) {
    try {
      const mod = await tool.load();
      const where = `command "${tool.path.join(" ")}"`;
      const params = tool.path.filter((p) => p.startsWith(":")).map((p) => p.slice(1));
      const { flags, positionals } = moduleSurface(mod, params, where);
      const rows = moduleRows(mod, where) ?? tool.meta?.rows;
      const meta = { ...(tool.meta ?? {}), ...(mod.meta ?? {}), ...(rows ? { rows } : {}) };
      routes.push({ path: tool.path, meta, flags, positionals });
    } catch {
      /* a broken module offers no acceptors; its own call reports the error */
    }
  }
  return { name, routes };
}

function linkedRowTrees(env: NodeJS.ProcessEnv): Promise<RowTree[]> {
  return new Promise((resolve) => {
    execFile(
      "clfly",
      ["manifest", "--json"],
      { env, timeout: SPAWN_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve([]);
        try {
          const parsed = JSON.parse(stdout) as { trees?: Array<RowTree & { error?: string }> };
          resolve((parsed.trees ?? []).filter((t) => !t.error && Array.isArray(t.routes)));
        } catch {
          resolve([]);
        }
      },
    );
  });
}
