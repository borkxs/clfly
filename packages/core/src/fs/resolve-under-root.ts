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

function escapeError(userPath: string, root: string): ClflyError {
  return new ClflyError(
    `Path escapes root: ${userPath}\n` +
      `Resolved paths must stay inside ${root}.`,
    2,
  );
}
