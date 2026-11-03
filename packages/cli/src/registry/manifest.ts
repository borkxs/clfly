import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildManifest, ClflyError, type ManifestRoute } from "@clfly/core";
import { registryPath } from "./paths.js";
import { readRegistry, type RegistryTree } from "./store.js";

/** Serializable route: the manifest minus `load`, `importPath`, and `inputSchema`. */
export type TreeRoute = Pick<ManifestRoute, "path" | "meta" | "flags" | "positionals" | "outputSchema">;

export interface TreeManifest {
  name: string;
  /** Executable to run with an argv array (no shell). */
  bin: string;
  root: string;
  description?: string;
  commandsDir?: string;
  routes: TreeRoute[];
  /** Set instead of `routes` content when the tree failed to build. */
  error?: string;
}

/** `commands/` is the convention; `src/commands/` covers trees that compile it to dist. */
const COMMANDS_DIR_CANDIDATES = ["commands", "src/commands"];

export function findCommandsDir(root: string): string | undefined {
  for (const rel of COMMANDS_DIR_CANDIDATES) {
    const dir = join(root, rel);
    if (existsSync(dir)) return dir;
  }
  return undefined;
}

let tsxRegistered: Promise<void> | undefined;

/** Tree command modules are TypeScript; load them through tsx. */
function registerTsx(): Promise<void> {
  tsxRegistered ??= import("tsx/esm/api").then(({ register }) => {
    register();
  });
  return tsxRegistered;
}

/**
 * Build each linked tree's manifest in memory. One tree failing does not
 * stop the rest; its entry carries `error` and no routes.
 */
export async function runManifest(input: {
  env: NodeJS.ProcessEnv;
  name?: string;
  commandsDir?: string;
}): Promise<{ trees: TreeManifest[] }> {
  const registry = readRegistry(registryPath(input.env));
  let trees = Object.values(registry.trees).sort((a, b) => a.name.localeCompare(b.name));
  if (input.name) {
    const tree = registry.trees[input.name];
    if (!tree) {
      throw new ClflyError(`No linked tree named "${input.name}". See \`clfly ls\`.`, 1);
    }
    trees = [tree];
  }
  await registerTsx();
  const out: TreeManifest[] = [];
  for (const tree of trees) out.push(await treeManifest(tree, input.commandsDir));
  return { trees: out };
}

async function treeManifest(tree: RegistryTree, commandsOverride?: string): Promise<TreeManifest> {
  const base: TreeManifest = {
    name: tree.name,
    bin: tree.bin,
    root: tree.root,
    routes: [],
    ...descriptionOf(tree.root),
  };
  const commandsDir = commandsOverride ?? findCommandsDir(tree.root);
  if (!commandsDir) {
    return { ...base, error: `No commands/ or src/commands/ under ${tree.root}` };
  }
  try {
    const { manifest } = await buildManifest({ commandsDir });
    const routes = manifest.routes.map(({ path, meta, flags, positionals, outputSchema }) => ({
      path,
      ...(meta ? { meta } : {}),
      flags,
      positionals,
      ...(outputSchema ? { outputSchema } : {}),
    }));
    return { ...base, commandsDir, routes };
  } catch (err) {
    return { ...base, commandsDir, error: err instanceof Error ? err.message : String(err) };
  }
}

function descriptionOf(root: string): { description?: string } {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { description?: unknown };
    return typeof pkg.description === "string" ? { description: pkg.description } : {};
  } catch {
    return {};
  }
}
