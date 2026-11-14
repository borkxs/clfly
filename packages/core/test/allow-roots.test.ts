import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClflyError } from "../src/errors.js";
import { createContext } from "../src/context.js";
import { resolveUnderRoots } from "../src/fs/resolve-under-root.js";
import { parseMcpServeFlags, isMcpServeArgv } from "../src/mcp/parse-serve-argv.js";
import { resolveMcpAllow } from "../src/mcp/project.js";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

describe("resolveUnderRoots", () => {
  it("accepts paths under root or an allowed dir, rejects the rest", () => {
    const root = tmp("clfly-root-");
    const extra = tmp("clfly-allow-");
    expect(resolveUnderRoots(root, [extra], "a")).toBe(join(root, "a"));
    expect(resolveUnderRoots(root, [extra], join(extra, "ledger.md"))).toBe(join(extra, "ledger.md"));
    expect(() => resolveUnderRoots(root, [extra], "/etc/passwd")).toThrow(ClflyError);
    expect(() => resolveUnderRoots(root, [extra], join(extra, "..", "sibling"))).toThrow(/allowed dir/);
  });

  it("rejects a symlink inside an allowed dir that leaves it", () => {
    const root = tmp("clfly-root-");
    const extra = tmp("clfly-allow-");
    const outside = tmp("clfly-out-");
    writeFileSync(join(outside, "secret.txt"), "x");
    try {
      symlinkSync(outside, join(extra, "out"));
    } catch {
      return; // no symlink privilege
    }
    expect(() => resolveUnderRoots(root, [extra], join(extra, "out", "secret.txt"))).toThrow(ClflyError);
  });
});

describe("createContext allow", () => {
  it("scoped resolvePath honours allow; without it the jail is unchanged", () => {
    const root = tmp("clfly-root-");
    const extra = tmp("clfly-allow-");
    const base = { argv: [], cwd: root, env: {}, commandPath: [], json: true, stdout: process.stdout, stderr: process.stderr, scoped: true };
    expect(createContext({ ...base, allow: [extra] }).resolvePath(join(extra, "x"))).toBe(join(extra, "x"));
    expect(() => createContext(base).resolvePath(join(extra, "x"))).toThrow(/escapes root/);
  });
});

describe("mcp serve --allow", () => {
  it("parses repeated --allow and keeps them out of path tokens", () => {
    const argv = ["mcp", "serve", "--root", "/r", "--allow", "/a", "--allow=/b"];
    expect(isMcpServeArgv(argv)).toBe(true);
    expect(parseMcpServeFlags(argv)).toEqual({ root: "/r", allow: ["/a", "/b"], help: false });
    expect(() => parseMcpServeFlags(["mcp", "serve", "--allow"])).toThrow(/requires a directory/);
  });
});

describe("resolveMcpAllow", () => {
  it("merges clfly.allow (expanded, relative to the package) with --allow", () => {
    const pkgDir = tmp("clfly-pkg-");
    mkdirSync(join(pkgDir, "state"));
    const pkg = join(pkgDir, "package.json");
    writeFileSync(pkg, JSON.stringify({ name: "t", clfly: { allow: ["~/git/notes", "${STATE}/loop", "$UNSET_X/y", "state"] } }));
    const allow = resolveMcpAllow({ name: "t", packageJsonPath: pkg, env: { HOME: "/h", STATE: "/s" }, allow: ["/extra", "/h/git/notes"] });
    expect(allow).toEqual(["/h/git/notes", "/s/loop", join(pkgDir, "state"), "/extra"]);
  });

  it("rejects a malformed clfly.allow", () => {
    const pkgDir = tmp("clfly-pkg-");
    const pkg = join(pkgDir, "package.json");
    writeFileSync(pkg, JSON.stringify({ name: "t", clfly: { allow: "/x" } }));
    expect(() => resolveMcpAllow({ name: "t", packageJsonPath: pkg, env: {} })).toThrow(/clfly.allow/);
  });
});
