import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harnessFile } from "../src/registry/harness.js";
import { hostLabel, hostPlist, hostTarget, installHost, uninstallHost, type Exec } from "../src/registry/host.js";
import { runRegister } from "../src/registry/register.js";

let tmp: string;
let env: NodeJS.ProcessEnv;
let project: string;
let tree: string;

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "clfly-host-")));
  env = { HOME: join(tmp, "home"), CLFLY_HOME: join(tmp, "clfly"), PATH: "/a/node_modules/.bin:/usr/bin:/usr/bin" };
  project = join(tmp, "project");
  tree = join(project, "packages", "demo");
  mkdirSync(join(tree, "bin"), { recursive: true });
  writeFileSync(join(tree, "package.json"), JSON.stringify({ name: "demo", bin: { demo: "./bin/demo.mjs" } }));
  writeFileSync(join(tree, "bin", "demo.mjs"), "#!/usr/bin/env node\n");
  chmodSync(join(tree, "bin", "demo.mjs"), 0o755);
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const register = (opts: Partial<Parameters<typeof runRegister>[0]>) =>
  runRegister({
    harness: "claude-code",
    scope: "user",
    project,
    tree,
    self: false,
    dryRun: false,
    remove: false,
    env,
    now: new Date("2026-11-10T00:00:00Z"),
    platform: "darwin",
    whichFn: () => null,
    ...opts,
  });

describe("register --http", () => {
  it("writes a type http entry for claude-code and replaces the stdio one", async () => {
    await register({});
    await register({ http: 4310 });
    const file = harnessFile({ harness: "claude-code", scope: "user", project, env, platform: "darwin" });
    const doc = JSON.parse(readFileSync(file, "utf8"));
    expect(doc.mcpServers.demo).toEqual({ type: "http", url: "http://127.0.0.1:4310/mcp" });
  });

  it("delegates to claude mcp add --transport http when claude is on PATH", async () => {
    const calls: string[][] = [];
    await register({
      http: 4310,
      whichFn: () => "/bin/claude",
      exec: async (cmd, args) => {
        calls.push([cmd, ...args]);
        return { stdout: "", stderr: "" };
      },
    });
    expect(calls).toEqual([
      ["claude", "mcp", "remove", "demo", "--scope", "user"],
      ["claude", "mcp", "add", "--transport", "http", "--scope", "user", "demo", "http://127.0.0.1:4310/mcp"],
    ]);
  });

  it("uses each harness's URL key and refuses claude-desktop", async () => {
    await register({ harness: "gemini", http: 1 });
    await register({ harness: "codex", http: 1 });
    const gemini = JSON.parse(readFileSync(join(tmp, "home", ".gemini", "settings.json"), "utf8"));
    expect(gemini.mcpServers.demo).toEqual({ httpUrl: "http://127.0.0.1:1/mcp" });
    expect(readFileSync(join(tmp, "home", ".codex", "config.toml"), "utf8")).toContain('url = "http://127.0.0.1:1/mcp"');
    await expect(register({ harness: "claude-desktop", http: 1 })).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe("host install", () => {
  it("keeps the user-scope stdio command plus --http under launchd", async () => {
    await register({});
    const target = hostTarget({ tree: "demo", port: 4400, env });
    expect(target.argv).toEqual([process.execPath, join(tree, "bin", "demo.mjs"), "mcp", "serve", "--root", tree, "--http", "4400"]);
    const plist = hostPlist(target, env);
    expect(plist).toMatchObject({ Label: hostLabel("demo"), KeepAlive: true, WorkingDirectory: tree });
    expect(plist.EnvironmentVariables.PATH).toBe("/usr/bin");
  });

  it("writes the plist and bootstraps it; uninstall boots it out", async () => {
    await register({});
    const calls: string[][] = [];
    const run: Exec = (cmd, args) => {
      calls.push([cmd, ...args]);
      return { status: 0, stdout: "", stderr: "" };
    };
    const result = await installHost({ tree: "demo", port: 4400, env, run });
    expect(result).toMatchObject({ tree: "demo", url: "http://127.0.0.1:4400/mcp", healthy: null });
    expect(calls.map((c) => c.slice(0, 2))).toEqual([
      ["plutil", "-convert"],
      ["launchctl", "bootout"],
      ["launchctl", "bootstrap"],
    ]);
    uninstallHost({ tree: "demo", env, run });
    expect(calls.at(-1)?.[1]).toBe("bootout");
  });

  it("refuses a tree that is not in the registry", () => {
    expect(() => hostTarget({ tree: "nope", port: 1, env })).toThrow(/No linked tree/);
  });

  it("hosts any command under --name (ts-mcp, groundwork-mcp), no registry needed", () => {
    const target = hostTarget({
      name: "ts-mcp",
      command: "/usr/bin/node /m/packages/ts-mcp/bin/ts-mcp.mjs  --http 4311 --project tsconfig.base.json",
      cwd: "/m",
      port: 4311,
      env,
    });
    expect(target).toEqual({
      name: "ts-mcp",
      argv: ["/usr/bin/node", "/m/packages/ts-mcp/bin/ts-mcp.mjs", "--http", "4311", "--project", "tsconfig.base.json"],
      root: "/m",
    });
    expect(hostPlist(target, env)).toMatchObject({ Label: hostLabel("ts-mcp"), WorkingDirectory: "/m" });
    expect(() => hostTarget({ command: "node x", port: 1, env })).toThrow(/needs --name/);
    expect(() => hostTarget({ name: "a/b", command: "node x", port: 1, env })).toThrow(/--name/);
  });
});
