import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { ClflyError } from "../errors.js";

/**
 * Resolve `userPath` under `root`, rejecting escapes (`..`, absolute paths
 * outside root, and symlink tricks that leave the root).
 *
 * Precedent: the reference filesystem MCP server's root scoping.
 */
export function resolveUnderRoot(root: string, userPath: string): string {
  const rootAbs = resolve(root);
  const candidate = resolve(rootAbs, userPath);

  if (!isInsideRoot(rootAbs, candidate)) {
    throw escapeError(userPath, rootAbs);
  }

  const rootReal = safeRealpath(rootAbs);
  const candidateReal = safeRealpath(candidate);
  if (!isInsideRoot(rootReal, candidateReal)) {
    throw escapeError(userPath, rootAbs);
  }

  return candidate;
}

/**
 * Resolve `userPath` against `root` (relative paths) and accept it when it
 * lands under `root` or under any `allow` directory (`mcp serve --allow`,
 * `clfly.allow` in the tree's package.json). Same symlink checks as
 * {@link resolveUnderRoot}.
 */
export function resolveUnderRoots(
  root: string,
  allow: readonly string[],
  userPath: string,
): string {
  const rootAbs = resolve(root);
  const candidate = resolve(rootAbs, userPath);
  const candidateReal = safeRealpath(candidate);
  for (const dir of [rootAbs, ...allow.map((d) => resolve(d))]) {
    if (isInsideRoot(dir, candidate) && isInsideRoot(safeRealpath(dir), candidateReal)) {
      return candidate;
    }
  }
  throw escapeError(userPath, rootAbs, allow);
}

/** True when `candidate` is `root` or a path beneath it. */
export function isInsideRoot(root: string, candidate: string): boolean {
  const rootAbs = resolve(root);
  const candidateAbs = resolve(candidate);
  if (candidateAbs === rootAbs) return true;
  const rel = relative(rootAbs, candidateAbs);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function safeRealpath(path: string): string {
  if (!existsSync(path)) {
    // Walk up to an existing ancestor so we can realpath the prefix,
    // then rejoin the missing suffix (blocks symlink escapes on parents).
    let cursor = path;
    const missing: string[] = [];
    while (!existsSync(cursor)) {
      const parent = resolve(cursor, "..");
      if (parent === cursor) break;
      missing.unshift(cursor.slice(parent.length).replace(/^[/\\]/, ""));
      cursor = parent;
    }
    if (!existsSync(cursor)) return path;
    const realPrefix = realpathSync(cursor);
    return missing.length === 0
      ? realPrefix
      : resolve(realPrefix, missing.join(sep));
  }
  return realpathSync(path);
}

function escapeError(userPath: string, root: string, allow: readonly string[] = []): ClflyError {
  const inside = allow.length ? `${root} or an allowed dir (${allow.join(", ")})` : root;
  return new ClflyError(
    `Path escapes root: ${userPath}\n` +
      `Resolved paths must stay inside ${inside}.\n` +
      `A tree that needs another directory lists it in package.json "clfly": { "allow": [...] }.`,
    2,
  );
}
