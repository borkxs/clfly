import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { ClflyError } from "@clfly/core";

export function writeAtomic(file: string, contents: string): void {
  const dir = dirname(file);
  const tmp = join(dir, `.${basename(file)}.${process.pid}.tmp`);
  writeFileSync(tmp, contents);
  // On Windows a rename over a file another process has open (Claude Code rewrites ~/.claude.json)
  // fails with EPERM; a few short retries ride it out.
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || attempt >= 6 || (code !== "EPERM" && code !== "EBUSY")) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * attempt);
    }
  }
}

/** Unified diff. Empty string when the texts match. `diff` exits 1 on a difference. */
export function unifiedDiff(before: string, after: string, label: string): string {
  if (before === after) return "";
  const dir = mkdtempSync(join(tmpdir(), "clfly-diff-"));
  const a = join(dir, "before");
  const b = join(dir, "after");
  try {
    writeFileSync(a, before);
    writeFileSync(b, after);
    const result = spawnSync("diff", ["-u", "--label", label, "--label", label, a, b], {
      encoding: "utf8",
    });
    if (result.status === 0) return "";
    if (result.status === 1) return result.stdout;
    throw new ClflyError(result.stderr || "diff failed", 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function readText(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "";
    throw new ClflyError(
      `Cannot read ${file}: ${err instanceof Error ? err.message : err}`,
      1,
    );
  }
}
