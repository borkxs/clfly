import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClflyError } from "../src/errors.js";
import { isInsideRoot, resolveUnderRoot } from "../src/fs/resolve-under-root.js";

describe("resolveUnderRoot", () => {
  it("resolves relative paths inside root", () => {
    const root = mkdtempSync(join(tmpdir(), "clfly-root-"));
    expect(resolveUnderRoot(root, "a/b")).toBe(join(root, "a", "b"));
    expect(resolveUnderRoot(root, ".")).toBe(root);
  });

  it("rejects parent escapes", () => {
    const root = mkdtempSync(join(tmpdir(), "clfly-root-"));
    expect(() => resolveUnderRoot(root, "../evil")).toThrow(ClflyError);
    expect(() => resolveUnderRoot(root, "a/../../evil")).toThrow(/escapes root/);
  });

  it("rejects absolute paths outside root", () => {
    const root = mkdtempSync(join(tmpdir(), "clfly-root-"));
    expect(() => resolveUnderRoot(root, "/etc/passwd")).toThrow(ClflyError);
  });

  it("rejects symlink escapes", () => {
    const root = mkdtempSync(join(tmpdir(), "clfly-root-"));
    const outside = mkdtempSync(join(tmpdir(), "clfly-out-"));
    writeFileSync(join(outside, "secret.txt"), "x");
    mkdirSync(join(root, "linkdir"), { recursive: true });
    try {
      symlinkSync(outside, join(root, "linkdir", "out"));
    } catch {
      // Windows without symlink privilege — skip.
      return;
    }
    expect(() => resolveUnderRoot(root, "linkdir/out/secret.txt")).toThrow(
      ClflyError,
    );
  });
});

describe("isInsideRoot", () => {
  it("handles equality and children", () => {
    expect(isInsideRoot("/a/b", "/a/b")).toBe(true);
    expect(isInsideRoot("/a/b", "/a/b/c")).toBe(true);
    expect(isInsideRoot("/a/b", "/a/c")).toBe(false);
  });
});
