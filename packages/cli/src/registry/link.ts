import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ClflyError } from "@clfly/core";
import { detectPackageManager, type PackageManager } from "../scaffold/detect.js";
import { serveInvocation } from "../skill/export.js";
import { registryPath } from "./paths.js";
import { readRegistry, writeRegistry, type RegistryTree } from "./store.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecFn = (
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) => Promise<ExecResult>;

export function spawnExec(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<ExecResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      reject(new ClflyError(`${command} failed to start: ${err.message}`, 1));
    });
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else {
        reject(
          new ClflyError(
            `${command} ${args.join(" ")} exited ${code ?? 1}${stderr ? `\n${stderr.trim()}` : ""}`,
            1,
          ),
        );
      }
    });
  });
}

export function which(name: string, env: NodeJS.ProcessEnv): string | null {
  const result = spawnSync("which", [name], { env, encoding: "utf8" });
  if (result.status !== 0) return null;
  const line = (result.stdout ?? "").trim().split("\n")[0];
  return line || null;
}

interface Pkg {
  bin?: string | Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function deriveTree(cwd: string): Omit<RegistryTree, "linkedAt" | "registered"> {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    throw new ClflyError(`No package.json in ${cwd}`, 2);
  }
  let pkg: Pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Pkg;
  } catch (err) {
    throw new ClflyError(
      `Cannot read ${pkgPath}: ${err instanceof Error ? err.message : err}`,
      1,
    );
  }
  const { skillName } = serveInvocation(cwd, pkg);
  const binRel = binFromPkg(pkg);
  if (!binRel) throw new ClflyError(`No bin in ${pkgPath}`, 2);
  const binAbs = resolve(cwd, binRel);
  const manifest = join(cwd, ".clfly", "manifest.json");
  return {
    path: samePath(cwd),
    bin: existsSync(binAbs) ? samePath(binAbs) : binAbs,
    name: skillName,
    coreVersion: readCoreVersion(cwd, pkg),
    manifest: existsSync(manifest) ? samePath(manifest) : null,
    root: samePath(cwd),
  };
}

function binFromPkg(pkg: Pkg): string | null {
  if (typeof pkg.bin === "string") return pkg.bin;
  if (pkg.bin && Object.keys(pkg.bin).length > 0) {
    const name = Object.keys(pkg.bin)[0]!;
    return pkg.bin[name] ?? null;
  }
  return null;
}

function readCoreVersion(cwd: string, pkg: Pkg): string {
  const installed = join(cwd, "node_modules", "@clfly", "core", "package.json");
  if (existsSync(installed)) {
    try {
      const version = (JSON.parse(readFileSync(installed, "utf8")) as { version?: string }).version;
      if (version) return version;
    } catch {
      /* fall through to the specifier */
    }
  }
  return pkg.dependencies?.["@clfly/core"] ?? pkg.devDependencies?.["@clfly/core"] ?? "unknown";
}

function samePath(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return resolve(file);
  }
}

/**
 * A package inside a pnpm workspace has no lockfile of its own (or a stray
 * one), so look for the workspace first and fall back to the package dir.
 */
export function linkPackageManager(dir: string, env: NodeJS.ProcessEnv): PackageManager {
  let cur = dir;
  while (true) {
    if (existsSync(join(cur, "pnpm-workspace.yaml"))) return "pnpm";
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return detectPackageManager(dir, { env });
}

export function linkArgv(pm: PackageManager): { command: string; args: string[] } {
  if (pm === "pnpm") return { command: "pnpm", args: ["link", "--global"] };
  return { command: "npm", args: ["link"] };
}

export function unlinkArgv(pm: PackageManager, name: string): { command: string; args: string[] } {
  if (pm === "pnpm") return { command: "pnpm", args: ["unlink", "--global", name] };
  return { command: "npm", args: ["unlink", "-g", name] };
}

export function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function runLink(input: {
  dir: string;
  env: NodeJS.ProcessEnv;
  now: Date;
  exec?: ExecFn;
}): Promise<RegistryTree> {
  const dir = samePath(input.dir);
  const derived = deriveTree(dir);
  const exec = input.exec ?? spawnExec;
  const pm = linkPackageManager(dir, input.env);
  const argv = linkArgv(pm);
  await exec(argv.command, argv.args, dir, input.env);

  const file = registryPath(input.env);
  const registry = readRegistry(file);
  const prev = registry.trees[derived.name];
  if (prev && samePath(prev.path) !== derived.path) {
    throw new ClflyError(
      `"${derived.name}" is already linked at ${prev.path}\nUnlink it before linking ${derived.path}.`,
      2,
    );
  }
  const tree: RegistryTree = {
    ...derived,
    linkedAt: input.now.toISOString(),
    registered: prev?.registered ?? {},
  };
  registry.trees[derived.name] = tree;
  writeRegistry(file, registry);
  return tree;
}

export async function runUnlink(input: {
  name: string;
  env: NodeJS.ProcessEnv;
  exec?: ExecFn;
}): Promise<{ name: string; path: string }> {
  const file = registryPath(input.env);
  const registry = readRegistry(file);
  const prev = registry.trees[input.name];
  if (!prev) throw new ClflyError(`"${input.name}" is not in the clfly registry`, 2);
  const exec = input.exec ?? spawnExec;
  const pm = existsSync(prev.path)
    ? linkPackageManager(prev.path, input.env)
    : "npm";
  const argv = unlinkArgv(pm, input.name);
  const cwd = existsSync(prev.path) ? prev.path : process.cwd();
  await exec(argv.command, argv.args, cwd, input.env);
  delete registry.trees[input.name];
  writeRegistry(file, registry);
  return { name: input.name, path: prev.path };
}

export interface LsRow {
  name: string;
  path: string;
  coreVersion: string;
  binResolvable: boolean;
  stale: boolean;
  harnesses: string[];
}

export function runLs(input: {
  env: NodeJS.ProcessEnv;
  prune: boolean;
  whichFn?: (name: string, env: NodeJS.ProcessEnv) => string | null;
}): { rows: LsRow[]; pruned: string[] } {
  const file = registryPath(input.env);
  const registry = readRegistry(file);
  const lookup = input.whichFn ?? which;
  const pruned: string[] = [];
  const rows: LsRow[] = [];
  for (const tree of Object.values(registry.trees)) {
    const stale = !existsSync(tree.path);
    if (stale && input.prune) {
      pruned.push(tree.name);
      delete registry.trees[tree.name];
      continue;
    }
    rows.push({
      name: tree.name,
      path: tree.path,
      coreVersion: tree.coreVersion,
      binResolvable: lookup(tree.name, input.env) !== null,
      stale,
      harnesses: Object.keys(tree.registered).sort(),
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  if (pruned.length > 0) writeRegistry(file, registry);
  return { rows, pruned };
}

export function formatLs(rows: LsRow[]): string {
  if (rows.length === 0) return "";
  const lines = ["name\tcore\tbin\tharnesses\tpath"];
  for (const row of rows) {
    const harnesses = row.harnesses.length > 0 ? row.harnesses.join(",") : "-";
    const where = row.stale ? `${row.path} (missing)` : row.path;
    lines.push(
      `${row.name}\t${row.coreVersion}\t${row.binResolvable ? "yes" : "no"}\t${harnesses}\t${where}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
