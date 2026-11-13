import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ClflyError, levenshtein } from "@clfly/core";
import { runLs, which } from "../registry/link.js";
import { type CallResult, listToolsOnce, type McpToolInfo } from "./client.js";

/** One command of one tree, as the hub indexes it. */
export interface HubTool {
  tree: string;
  /** The tree's MCP tool name (`du`, `align_agree`). */
  name: string;
  description: string;
  inputSchema?: McpToolInfo["inputSchema"];
  readOnly?: boolean;
  destructive?: boolean;
}

export interface HubTree {
  name: string;
  path: string;
  bin: string | null;
  description?: string;
  /** Newest mtime of the files that define the tree's commands; the cache key. */
  stamp: number;
  tools: HubTool[];
  error?: string;
}

export interface HubIndex {
  trees: HubTree[];
}

/** Trees the hub never proxies: the hub's own tree. */
const SELF = "clfly";
/** Per-tree session tools: callable through the hub, but not indexed or listed. */
const SESSION_TOOLS = new Set(["result_read", "result_query"]);

export type ListToolsFn = (bin: string, cwd: string, env: NodeJS.ProcessEnv) => Promise<McpToolInfo[]>;

export function hubCachePath(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
  return join(base, "clfly", "hub-index.json");
}

/** Newest mtime under the paths that define a tree's commands (package.json, manifest, commands dirs). */
export function treeStamp(path: string): number {
  let newest = 0;
  const visit = (p: string, depth: number) => {
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    newest = Math.max(newest, st.mtimeMs);
    if (!st.isDirectory() || depth > 6) return;
    for (const entry of readdirSync(p)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      visit(join(p, entry), depth + 1);
    }
  };
  for (const rel of ["package.json", ".clfly/manifest.json", "commands", "src/commands"]) visit(join(path, rel), 0);
  return Math.floor(newest);
}

function oneLine(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function packageDescription(path: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as { description?: string };
    return pkg.description ? oneLine(pkg.description) : undefined;
  } catch {
    return undefined;
  }
}

function readCache(file: string): Record<string, HubTree> {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { trees?: HubTree[] };
    return Object.fromEntries((parsed.trees ?? []).map((t) => [t.name, t]));
  } catch {
    return {};
  }
}

/**
 * Every linked tree's commands, from the on-disk cache where a tree's files
 * have not changed, else by asking the tree's own `mcp serve` (in parallel).
 */
export async function loadIndex(options: {
  env: NodeJS.ProcessEnv;
  cacheFile?: string;
  listTools?: ListToolsFn;
  whichFn?: (name: string, env: NodeJS.ProcessEnv) => string | null;
  refresh?: boolean;
}): Promise<HubIndex> {
  const cacheFile = options.cacheFile ?? hubCachePath(options.env);
  const cached = options.refresh ? {} : readCache(cacheFile);
  const lookup = options.whichFn ?? which;
  const list = options.listTools ?? listToolsOnce;
  const { rows } = runLs({ env: options.env, prune: false, whichFn: lookup });
  const trees = await Promise.all(
    rows
      .filter((row) => !row.stale && row.name !== SELF)
      .map(async (row): Promise<HubTree> => {
        const stamp = treeStamp(row.path);
        const hit = cached[row.name];
        if (hit && hit.path === row.path && hit.stamp === stamp && !hit.error) return hit;
        const bin = lookup(row.name, options.env);
        const tree: HubTree = { name: row.name, path: row.path, bin, description: packageDescription(row.path), stamp, tools: [] };
        try {
          if (!bin) throw new Error(`${row.name} is not on PATH`);
          const tools = await list(bin, row.path, options.env);
          tree.tools = tools
            .filter((t) => !SESSION_TOOLS.has(t.name))
            .map((t) => ({
              tree: row.name,
              name: t.name,
              description: oneLine(t.description),
              ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
              ...(t.annotations?.readOnlyHint !== undefined ? { readOnly: t.annotations.readOnlyHint } : {}),
              ...(t.annotations?.destructiveHint !== undefined ? { destructive: t.annotations.destructiveHint } : {}),
            }));
        } catch (err) {
          tree.error = err instanceof Error ? err.message : String(err);
        }
        return tree;
      }),
  );
  trees.sort((a, b) => a.name.localeCompare(b.name));
  try {
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, `${JSON.stringify({ builtAt: new Date().toISOString(), trees }, null, 1)}\n`);
  } catch {
    // A read-only state dir only costs the next start a rebuild.
  }
  return { trees };
}

/** A tool's command words: `align_eval_board` → `align eval board`. */
export const commandWords = (t: Pick<HubTool, "name">): string => t.name.replace(/_/g, " ");

/** The name to pass back to `call`: `<tree> <command words>`. */
export const toolRef = (t: Pick<HubTool, "tree" | "name">): string => `${t.tree} ${commandWords(t)}`;

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/**
 * Rank commands for a free-text query: a word naming the tree or a command
 * segment counts 3, a word in the command's description 1, in the tree's
 * description 0.5 (prefix matches count, so "transfer" finds "transfers").
 * Commands that match nothing are dropped.
 */
export function searchIndex(index: HubIndex, query: string, limit = 8): Array<HubTool & { score: number }> {
  const q = words(query);
  if (q.length === 0) return [];
  const hits: Array<HubTool & { score: number }> = [];
  for (const tree of index.trees) {
    for (const tool of tree.tools) {
      const strong = [...words(tool.tree), ...words(tool.name)];
      const weak = words(tool.description);
      const treeDesc = words(tree.description ?? "");
      const hit = (list: string[], w: string) => list.some((s) => s === w || (w.length >= 4 && s.startsWith(w)));
      let score = 0;
      for (const w of q) {
        if (hit(strong, w)) score += 3;
        else if (hit(weak, w)) score += 1;
        // The tree's own description matches all its commands alike: it only breaks ties.
        else if (hit(treeDesc, w)) score += 0.5;
      }
      if (score > 0) hits.push({ ...tool, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score || toolRef(a).localeCompare(toolRef(b))).slice(0, limit);
}

/**
 * Resolve what a caller names into a tree and that tree's MCP tool name.
 * Accepts `pm du`, `pm_du`, `mcp__pm__du` and `texts-cli align agree`; the
 * per-tree `result_read` / `result_query` resolve too (`pm result_read`).
 */
export function resolveTool(index: HubIndex, ref: string): { tree: HubTree; tool: string; known?: HubTool } {
  const raw = ref.trim();
  let treeName: string | undefined;
  let rest = "";
  const mcp = /^mcp__([^_]+(?:-[^_]+)*)__(.+)$/.exec(raw);
  if (mcp) {
    treeName = mcp[1];
    rest = mcp[2]!;
  } else {
    const names = index.trees.map((t) => t.name).sort((a, b) => b.length - a.length);
    treeName = names.find((n) => raw === n || raw.startsWith(`${n} `) || raw.startsWith(`${n}_`));
    if (treeName) rest = raw.slice(treeName.length + 1);
  }
  const tree = index.trees.find((t) => t.name === treeName);
  if (!tree) {
    throw new ClflyError(`No linked tree in "${ref}". Trees: ${index.trees.map((t) => t.name).join(", ")}`, 2);
  }
  const tool = rest.trim().replace(/[\s]+/g, "_");
  const known = tree.tools.find((t) => t.name === tool);
  if (!known && !SESSION_TOOLS.has(tool)) {
    const near = tree.tools
      .map((t) => ({ t, d: levenshtein(t.name, tool) }))
      .filter((x) => x.d <= Math.max(2, Math.floor(tool.length / 3)))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((x) => toolRef(x.t));
    throw new ClflyError(`${tree.name} has no command "${commandWords({ name: tool })}"${near.length ? `. Close: ${near.join(", ")}` : ""}`, 2);
  }
  return { tree, tool, ...(known ? { known } : {}) };
}

/** Distinct command words of a tree in first-seen order: the recognition keywords. */
export function treeKeywords(tree: HubTree): string[] {
  const seen = new Set<string>();
  for (const t of tree.tools) for (const w of t.name.split("_")) if (w) seen.add(w);
  return [...seen];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Server instructions: how to use the hub, then one flat keyword line per tree. */
export function renderInstructions(index: HubIndex): string {
  const lines = [
    "This machine's clfly CLI trees; each is also a bin on PATH (`<tree> <command> --help`).",
    "find(query) returns commands with input schema; call(tool, input) runs one (tool = `<tree> <command>`); destructive ones only via call-destructive. Spooled refs: call(`<tree> result_read`).",
    "Trees and their command words:",
  ];
  for (const tree of index.trees) {
    // A tree that failed to list stays visible with its error, so a session knows it exists and why find cannot reach it.
    if (tree.error) {
      lines.push(`- ${tree.name}: unavailable (${clip(tree.error.replace(/\s+/g, " "), 90)})`);
      continue;
    }
    const desc = (tree.description ?? "").replace(/^(a )?clfly (command )?tree( that| for)?\s*/i, "");
    const head = (desc.split(/[:;(]|\. /)[0] ?? "").trim();
    const about = head ? ` (${clip(head, 36)})` : "";
    lines.push(`- ${tree.name}${about}: ${treeKeywords(tree).join(" ")}`);
  }
  return lines.join("\n");
}

/** Turn a tree's tools/call result into a command return value (or throw its error). */
export function unwrapCall(ref: string, result: CallResult): unknown {
  const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
  if (result.isError) throw new ClflyError(`${ref}: ${text || "failed"}`, 1);
  const sc = result.structuredContent;
  if (sc !== undefined) {
    // MCP structuredContent must be an object, so a tree wraps an array return
    // as `{ result: [...] }`; its text content is the bare array. Return the
    // array, so a spooled `@<ref>` binds what the command returned.
    const wrapped = sc !== null && typeof sc === "object" ? (sc as Record<string, unknown>) : undefined;
    if (wrapped && Object.keys(wrapped).length === 1 && Array.isArray(wrapped.result) && text.trimStart().startsWith("[")) {
      return wrapped.result;
    }
    return sc;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
