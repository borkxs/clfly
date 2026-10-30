import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HARNESSES, harnessFile, type Harness, type Scope } from "../src/registry/harness.js";
import { linkPackageManager, runLink, runLs, runUnlink, type ExecFn } from "../src/registry/link.js";
import { registryPath } from "../src/registry/paths.js";
import { runRegister, selfDir } from "../src/registry/register.js";
import { readRegistry } from "../src/registry/store.js";

const now = new Date("2026-10-30T12:00:00.000Z");
const okExec: ExecFn = async () => ({ stdout: "", stderr: "" });
const noWhich = () => null;

let tmp: string;
let env: NodeJS.ProcessEnv;
let project: string;
let tree: string;

function makeTree(dir: string, name: string, executable = true): void {
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, bin: { [name]: `./bin/${name}.mjs` } }));
  writeFileSync(join(dir, "bin", `${name}.mjs`), "#!/usr/bin/env node\n");
  chmodSync(join(dir, "bin", `${name}.mjs`), executable ? 0o755 : 0o644);
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "clfly-registry-")));
  env = { HOME: join(tmp, "home"), CLFLY_HOME: join(tmp, "clfly") };
  project = join(tmp, "project");
  tree = join(project, "packages", "demo");
  makeTree(tree, "demo");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function register(opts: Partial<Parameters<typeof runRegister>[0]> & { harness: Harness }) {
  return runRegister({
    scope: "project",
    project,
    tree,
    self: false,
    dryRun: false,
    remove: false,
    env,
    now,
    platform: "darwin",
    whichFn: noWhich,
    ...opts,
  });
}

describe("link / unlink / ls", () => {
  it("links, records the tree, and keeps registered on a re-link", async () => {
    const calls: string[][] = [];
    const exec: ExecFn = async (cmd, args) => {
      calls.push([cmd, ...args]);
      return { stdout: "", stderr: "" };
    };
    const entry = await runLink({ dir: tree, env, now, exec });
    expect(calls).toEqual([["npm", "link"]]);
    expect(entry).toMatchObject({ name: "demo", path: tree, root: tree, linkedAt: now.toISOString() });

    await register({ harness: "cursor" });
    const again = await runLink({ dir: tree, env, now, exec });
    expect(Object.keys(again.registered)).toEqual(["cursor:project"]);
  });

  it("uses pnpm for a package inside a pnpm workspace, even with a stray lockfile", () => {
    writeFileSync(join(project, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    writeFileSync(join(tree, "package-lock.json"), "{}");
    expect(linkPackageManager(tree, {})).toBe("pnpm");
    rmSync(join(project, "pnpm-workspace.yaml"));
    expect(linkPackageManager(tree, {})).toBe("npm");
  });

  it("refuses a second tree with the same name", async () => {
    await runLink({ dir: tree, env, now, exec: okExec });
    const other = join(tmp, "other");
    makeTree(other, "demo");
    await expect(runLink({ dir: other, env, now, exec: okExec })).rejects.toMatchObject({ exitCode: 2 });
  });

  it("writes nothing when the package manager fails", async () => {
    const fail: ExecFn = async () => {
      throw new Error("boom");
    };
    await expect(runLink({ dir: tree, env, now, exec: fail })).rejects.toThrow("boom");
    expect(existsSync(registryPath(env))).toBe(false);
  });

  it("unlink removes the entry; a missing name exits 2", async () => {
    await runLink({ dir: tree, env, now, exec: okExec });
    await expect(runUnlink({ name: "nope", env, exec: okExec })).rejects.toMatchObject({ exitCode: 2 });
    await runUnlink({ name: "demo", env, exec: okExec });
    expect(readRegistry(registryPath(env)).trees).toEqual({});
  });

  it("ls shows stale entries and --prune drops them", async () => {
    await runLink({ dir: tree, env, now, exec: okExec });
    rmSync(tree, { recursive: true });
    const shown = runLs({ env, prune: false, whichFn: noWhich });
    expect(shown.rows).toMatchObject([{ name: "demo", stale: true, binResolvable: false }]);
    const pruned = runLs({ env, prune: true, whichFn: noWhich });
    expect(pruned).toEqual({ rows: [], pruned: ["demo"] });
  });
});

describe("register", () => {
  const combos: Array<[Harness, Scope]> = HARNESSES.flatMap((h) =>
    (h === "claude-desktop" ? ["user"] : ["project", "user"]).map((s) => [h, s as Scope] as [Harness, Scope]),
  );

  it.each(combos)("%s %s: adds one entry and keeps the others", async (harness, scope) => {
    const file = harnessFile({ harness, scope, project, env, platform: "darwin" });
    mkdirSync(join(file, ".."), { recursive: true });
    const before =
      harness === "codex"
        ? 'model = "o3"\n\n[mcp_servers.other]\ncommand = "other"\nargs = []\n'
        : JSON.stringify({ theme: "dark", [harness === "vscode" ? "servers" : "mcpServers"]: { other: { command: "other" } } });
    writeFileSync(file, before);

    const result = await register({ harness, scope });
    expect(result).toMatchObject({ changed: true, via: "file", name: "demo" });
    const after = readFileSync(file, "utf8").split(tmp).join("<tmp>").split(process.execPath).join("<node>");
    expect(after).toMatchSnapshot();

    const second = await register({ harness, scope });
    expect(second.changed).toBe(false);
    expect(readRegistry(registryPath(env)).trees.demo?.registered[`${harness}:${scope}`]).toBe(now.toISOString());

    await register({ harness, scope, remove: true });
    const removed = readFileSync(file, "utf8");
    expect(removed).not.toContain("demo");
    expect(removed).toContain("other");
    expect(readRegistry(registryPath(env)).trees.demo?.registered).toEqual({});
  });

  it("dry-run prints a diff and writes nothing", async () => {
    const result = await register({ harness: "gemini", dryRun: true });
    expect(result.diff).toContain('+    "demo": {');
    expect(existsSync(join(project, ".gemini", "settings.json"))).toBe(false);
    expect(existsSync(registryPath(env))).toBe(false);
  });

  it("project scope writes paths inside the project as ./-relative", async () => {
    const result = await register({ harness: "cursor" });
    expect(result.record).toEqual({
      name: "demo",
      command: "./packages/demo/bin/demo.mjs",
      args: ["mcp", "serve", "--root", "./packages/demo"],
    });
  });

  it("a non-executable bin runs through node; user scope pins this node", async () => {
    makeTree(tree, "demo", false);
    const project_ = await register({ harness: "cursor" });
    expect(project_.record.command).toBe("node");
    expect(project_.record.args[0]).toBe("./packages/demo/bin/demo.mjs");
    const user = await register({ harness: "cursor", scope: "user" });
    expect(user.record.command).toBe(process.execPath);
    expect(user.record.args[0]).toBe(join(tree, "bin", "demo.mjs"));
  });

  it("user scope runs an executable JS bin through this node", async () => {
    const user = await register({ harness: "claude-desktop", scope: "user" });
    expect(user.record).toEqual({
      name: "demo",
      command: process.execPath,
      args: [join(tree, "bin", "demo.mjs"), "mcp", "serve", "--root", tree],
    });
    const project_ = await register({ harness: "cursor" });
    expect(project_.record.command).toBe("./packages/demo/bin/demo.mjs");
  });

  it("--self registers @clfly/cli without --root", async () => {
    const result = await register({ harness: "cursor", scope: "user", self: true, tree: undefined });
    expect(result.tree).toBe("clfly");
    expect(result.record.args.slice(-2)).toEqual(["mcp", "serve"]);
    expect(result.record.args).not.toContain("--root");
    expect(readRegistry(registryPath(env)).trees.clfly).toMatchObject({ path: selfDir(), linkedAt: null });
  });

  it("--name renames only the harness entry", async () => {
    const result = await register({ harness: "cursor", name: "demo-dev" });
    const doc = JSON.parse(readFileSync(join(project, ".cursor", "mcp.json"), "utf8"));
    expect(Object.keys(doc.mcpServers)).toEqual(["demo-dev"]);
    expect(result.tree).toBe("demo");
  });

  it("--tree accepts a registry name", async () => {
    await runLink({ dir: tree, env, now, exec: okExec });
    const result = await register({ harness: "cursor", tree: "demo" });
    expect(result.record.command).toBe("./packages/demo/bin/demo.mjs");
  });

  it("claude-desktop rejects project scope", async () => {
    await expect(register({ harness: "claude-desktop" })).rejects.toMatchObject({ exitCode: 2 });
  });

  it("leaves a file that is not an object untouched and exits 1", async () => {
    const file = join(project, ".mcp.json");
    writeFileSync(file, "[1, 2]");
    await expect(register({ harness: "claude-code" })).rejects.toMatchObject({ exitCode: 1 });
    expect(readFileSync(file, "utf8")).toBe("[1, 2]");
  });

  it("hands claude-code to the claude CLI when it is on PATH", async () => {
    const calls: string[][] = [];
    const exec: ExecFn = async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (args[1] === "remove") throw new Error("not found");
      return { stdout: "", stderr: "" };
    };
    const result = await register({ harness: "claude-code", exec, whichFn: () => "/bin/claude" });
    expect(result.via).toBe("claude");
    expect(calls).toEqual([
      ["claude", "mcp", "remove", "demo", "--scope", "project"],
      [
        "claude", "mcp", "add", "--transport", "stdio", "--scope", "project", "demo", "--",
        "./packages/demo/bin/demo.mjs", "mcp", "serve", "--root", "./packages/demo",
      ],
    ]);
    expect(existsSync(join(project, ".mcp.json"))).toBe(false);
  });
});
