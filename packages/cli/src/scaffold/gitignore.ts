import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const GITIGNORE_ENTRY = ".clfly/";

/**
 * Idempotently ensure `.clfly/` is listed in `<dir>/.gitignore`.
 * Creates the file when missing. Returns true when a write occurred.
 */
export function ensureClflyGitignore(dir: string): boolean {
  const path = join(dir, ".gitignore");
  if (!existsSync(path)) {
    writeFileSync(path, `${GITIGNORE_ENTRY}\n`, "utf8");
    return true;
  }
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/);
  if (lines.some((l) => l.trim() === GITIGNORE_ENTRY || l.trim() === ".clfly")) {
    return false;
  }
  const suffix = raw.endsWith("\n") || raw.length === 0 ? "" : "\n";
  writeFileSync(path, `${raw}${suffix}${GITIGNORE_ENTRY}\n`, "utf8");
  return true;
}
