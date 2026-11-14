#!/usr/bin/env node
// Root postinstall: make a fresh checkout or worktree able to typecheck and test pocket.
// packages/raycast is outside the pnpm workspace (Raycast wants npm), so `pnpm install` never
// gives it node_modules/@clfly/core; pocket compiles raycast's src/lib files, which import it.
// Both also resolve @clfly/core through its dist, which a fresh checkout has not built yet.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Link packages/raycast/node_modules/@clfly/core to packages/core. Returns what it did. */
export function linkRaycastCore(root) {
  const core = join(root, "packages", "core");
  const link = join(root, "packages", "raycast", "node_modules", "@clfly", "core");
  const target = relative(dirname(link), core);
  let stat;
  try {
    stat = lstatSync(link);
  } catch {
    stat = undefined;
  }
  if (stat?.isSymbolicLink()) {
    if (resolve(dirname(link), readlinkSync(link)) === core) return "kept";
    rmSync(link);
  } else if (stat) {
    return "kept"; // a real directory (an npm install copied it): leave it alone
  }
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, "dir");
  return "linked";
}

/** Build @clfly/core when its dist is missing. `run` is injectable for tests. */
export function ensureCoreDist(root, run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: "inherit" }).status) {
  if (existsSync(join(root, "packages", "core", "dist", "index.js"))) return "kept";
  const status = run("pnpm", ["--filter", "@clfly/core", "build"]);
  if (status !== 0) throw new Error(`@clfly/core build failed (exit ${status})`);
  return "built";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  console.log(`setup: raycast @clfly/core ${linkRaycastCore(root)}, core dist ${ensureCoreDist(root)}`);
}
