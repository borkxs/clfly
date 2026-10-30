import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ClflyError } from "@clfly/core";
import {
  delegateArgv,
  harnessFile,
  projectFile,
  type Harness,
  type Scope,
  type ServerRecord,
} from "./harness.js";
import { readText, unifiedDiff, writeAtomic } from "./io.js";
import { deriveTree, isExecutable, spawnExec, which, type ExecFn } from "./link.js";
import { registryPath } from "./paths.js";
import { readRegistry, writeRegistry, type RegistryTree } from "./store.js";

export interface RegisterInput {
  harness: Harness;
  scope: Scope;
  /** Directory the project-scope harness file lives in. */
  project: string;
  /** Registry name or package directory. Defaults to `project`. */
  tree?: string;
  self: boolean;
  name?: string;
  dryRun: boolean;
  remove: boolean;
  env: NodeJS.ProcessEnv;
  now: Date;
  platform?: NodeJS.Platform;
  exec?: ExecFn;
  whichFn?: (name: string, env: NodeJS.ProcessEnv) => string | null;
}

export interface RegisterResult {
  harness: Harness;
  scope: Scope;
  name: string;
  tree: string;
  file: string;
  action: "add" | "remove";
  /** `file` when the harness file was edited, otherwise the harness CLI that did it. */
  via: "file" | "claude" | "codex";
  changed: boolean;
  dryRun: boolean;
  record: ServerRecord;
  diff?: string;
}

/** Package directory of the running `@clfly/cli`. */
export function selfDir(from: string = fileURLToPath(import.meta.url)): string {
  let dir = dirname(from);
  while (true) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      const name = (JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name;
      if (name === "@clfly/cli") return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new ClflyError("Cannot find the @clfly/cli package directory", 1);
    dir = parent;
  }
}

function resolveTree(input: RegisterInput, registry: ReturnType<typeof readRegistry>): {
  tree: Omit<RegistryTree, "linkedAt" | "registered">;
  prev?: RegistryTree;
} {
  if (input.self) {
    const tree = deriveTree(selfDir());
    return { tree, prev: registry.trees[tree.name] };
  }
  const byName = input.tree ? registry.trees[input.tree] : undefined;
  if (byName) return { tree: byName, prev: byName };
  const dir = input.tree ? resolve(input.project, input.tree) : input.project;
  const tree = deriveTree(dir);
  const prev = registry.trees[tree.name];
  if (prev && prev.path !== tree.path) {
    throw new ClflyError(
      `"${tree.name}" is already in the registry at ${prev.path}\nPass --tree ${tree.name} to register that one.`,
      2,
    );
  }
  return { tree, prev };
}

/** Project scope writes paths inside the project as `./`-relative; everything else stays absolute. */
function scoped(path: string, project: string, scope: Scope): string {
  if (scope !== "project") return path;
  const rel = relative(project, path);
  if (rel === "") return ".";
  if (rel.startsWith("..") || isAbsolute(rel)) return path;
  return `./${rel.split("\\").join("/")}`;
}

export function projectRecord(input: {
  tree: Pick<RegistryTree, "bin" | "root" | "name">;
  self: boolean;
  scope: Scope;
  project: string;
  name?: string;
  executable: boolean;
}): ServerRecord {
  const { tree, scope, project } = input;
  const serve = input.self
    ? ["mcp", "serve"]
    : ["mcp", "serve", "--root", scoped(tree.root, project, scope)];
  const bin = scoped(tree.bin, project, scope);
  const name = input.name ?? tree.name;
  if (input.executable) return { name, command: bin, args: serve };
  // GUI harnesses do not inherit a shell PATH, so user scope pins this node.
  const node = scope === "user" ? process.execPath : "node";
  return { name, command: node, args: [bin, ...serve] };
}

export async function runRegister(input: RegisterInput): Promise<RegisterResult> {
  const platform = input.platform ?? process.platform;
  const file = harnessFile({
    harness: input.harness,
    scope: input.scope,
    project: input.project,
    env: input.env,
    platform,
  });
  const regFile = registryPath(input.env);
  const registry = readRegistry(regFile);
  const { tree, prev } = resolveTree(input, registry);
  const record = projectRecord({
    tree,
    self: input.self,
    scope: input.scope,
    project: input.project,
    name: input.name,
    executable: isExecutable(tree.bin),
  });

  const before = readText(file);
  const after = projectFile({
    harness: input.harness,
    file,
    before,
    record,
    remove: input.remove,
  });
  const base = {
    harness: input.harness,
    scope: input.scope,
    name: record.name,
    tree: tree.name,
    file,
    action: input.remove ? ("remove" as const) : ("add" as const),
    changed: before !== after,
    dryRun: input.dryRun,
    record,
  };

  if (input.dryRun) {
    return { ...base, via: "file", diff: unifiedDiff(before, after, file) };
  }

  const lookup = input.whichFn ?? which;
  const delegate = delegateArgv({
    harness: input.harness,
    scope: input.scope,
    record,
    remove: input.remove,
  });
  let via: RegisterResult["via"] = "file";
  if (delegate && lookup(delegate.bin, input.env)) {
    const exec = input.exec ?? spawnExec;
    for (const step of delegate.steps) {
      try {
        await exec(delegate.bin, step.args, input.project, input.env);
      } catch (err) {
        if (!step.mayFail) throw err;
      }
    }
    via = delegate.bin as "claude" | "codex";
  } else if (before !== after) {
    mkdirSync(dirname(file), { recursive: true });
    writeAtomic(file, after);
  }

  const key = `${input.harness}:${input.scope}`;
  if (input.remove) {
    if (prev && key in prev.registered) {
      delete prev.registered[key];
      writeRegistry(regFile, registry);
    }
  } else {
    const entry: RegistryTree = prev ?? { ...tree, linkedAt: null, registered: {} };
    entry.registered[key] = input.now.toISOString();
    registry.trees[tree.name] = entry;
    writeRegistry(regFile, registry);
  }
  return { ...base, via };
}
