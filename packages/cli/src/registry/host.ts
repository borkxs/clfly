import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { ClflyError } from "@clfly/core";
import { deriveTree, isExecutable } from "./link.js";
import { userHome } from "./paths.js";
import { hostUrl, projectRecord, selfDir } from "./register.js";
import { readRegistry } from "./store.js";
import { registryPath } from "./paths.js";

/**
 * One long-lived `<tree> mcp serve --http <port>` per tree, kept up by a
 * launchd user agent (KeepAlive, like `dash install`), so every agent session
 * shares one server process instead of spawning its own stdio copy.
 */
export const DEFAULT_HOST_PORT = 4310;

export const hostLabel = (tree: string) => `com.borkxs.clfly.host.${tree}`;

export const hostPlistPath = (tree: string, env: NodeJS.ProcessEnv) =>
  join(userHome(env), "Library", "LaunchAgents", `${hostLabel(tree)}.plist`);

export function hostLogPath(tree: string, env: NodeJS.ProcessEnv): string {
  const base = env.XDG_STATE_HOME || join(userHome(env), ".local", "state");
  return join(base, "clfly", "host", `${tree}.log`);
}

/** Drop duplicates and the node_modules/.bin entries pnpm/npx prepend. */
export const cleanPath = (path: string) =>
  [...new Set(path.split(":").filter((p) => p && !p.includes("/node_modules/")))].join(":");

export interface HostTarget {
  name: string;
  /** argv launchd runs: the user-scope stdio command plus `--http <port>`. */
  argv: string[];
  root: string;
}

/**
 * Resolve `clfly` (self) or a registry name to the command launchd keeps up.
 * With `command`, host any MCP server that has its own HTTP mode (ts-mcp,
 * groundwork-mcp): `name` labels it, the command already carries its port.
 */
export function hostTarget(input: {
  tree?: string;
  port: number;
  env: NodeJS.ProcessEnv;
  name?: string;
  command?: string;
  cwd?: string;
}): HostTarget {
  if (input.command !== undefined) {
    const argv = input.command.trim().split(/\s+/).filter(Boolean);
    if (!input.name) throw new ClflyError("--command needs --name (the launchd label and log name)", 2);
    if (!argv.length) throw new ClflyError("--command is empty", 2);
    if (!/^[\w.-]+$/.test(input.name)) throw new ClflyError(`--name "${input.name}": letters, digits, . _ - only`, 2);
    return { name: input.name, argv, root: input.cwd ?? process.cwd() };
  }
  const self = !input.tree || input.tree === "clfly";
  let tree;
  if (self) {
    tree = deriveTree(selfDir());
  } else {
    tree = readRegistry(registryPath(input.env)).trees[input.tree!];
    if (!tree) throw new ClflyError(`No linked tree "${input.tree}" (clfly ls lists them)`, 2);
  }
  const record = projectRecord({ tree, self, scope: "user", project: tree.path, executable: isExecutable(tree.bin) });
  return { name: tree.name, argv: [record.command, ...record.args, "--http", String(input.port)], root: tree.path };
}

export function hostPlist(target: HostTarget, env: NodeJS.ProcessEnv) {
  const log = hostLogPath(target.name, env);
  return {
    Label: hostLabel(target.name),
    ProgramArguments: target.argv,
    WorkingDirectory: target.root,
    EnvironmentVariables: {
      PATH: cleanPath(env.PATH ?? "/usr/bin:/bin"),
      HOME: userHome(env),
      ...(env.CLFLY_HOME ? { CLFLY_HOME: env.CLFLY_HOME } : {}),
      ...(env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: env.XDG_CONFIG_HOME } : {}),
      ...(env.XDG_STATE_HOME ? { XDG_STATE_HOME: env.XDG_STATE_HOME } : {}),
    },
    KeepAlive: true,
    RunAtLoad: true,
    StandardOutPath: log,
    StandardErrorPath: log,
    ProcessType: "Background",
  };
}

export type Exec = (cmd: string, args: string[], input?: string) => { status: number | null; stdout: string; stderr: string };

const exec: Exec = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, encoding: "utf8" });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

const domain = () => `gui/${process.getuid?.() ?? 501}`;

export interface HostResult {
  tree: string;
  port: number;
  url: string;
  plist: string;
  log: string;
  argv: string[];
  /** `/health` answered after the start (null when not probed). */
  healthy: boolean | null;
}

async function probe(port: number, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

export async function installHost(input: {
  tree?: string;
  name?: string;
  command?: string;
  cwd?: string;
  port: number;
  env: NodeJS.ProcessEnv;
  dryRun?: boolean;
  run?: Exec;
  probeMs?: number;
}): Promise<HostResult> {
  if (process.platform !== "darwin" && !input.run) throw new ClflyError("clfly host install needs macOS launchd", 1);
  const target = hostTarget(input);
  const plist = hostPlistPath(target.name, input.env);
  const log = hostLogPath(target.name, input.env);
  const base = { tree: target.name, port: input.port, url: hostUrl(input.port), plist, log, argv: target.argv };
  if (input.dryRun) return { ...base, healthy: null };
  const run = input.run ?? exec;
  mkdirSync(dirname(plist), { recursive: true });
  mkdirSync(dirname(log), { recursive: true });
  const conv = run("plutil", ["-convert", "xml1", "-o", plist, "-"], JSON.stringify(hostPlist(target, input.env)));
  if (conv.status !== 0) throw new ClflyError(`plutil failed: ${conv.stderr.trim()}`, 1);
  run("launchctl", ["bootout", `${domain()}/${hostLabel(target.name)}`]);
  const boot = run("launchctl", ["bootstrap", domain(), plist]);
  if (boot.status !== 0) throw new ClflyError(`launchctl bootstrap failed: ${boot.stderr.trim()}`, 1);
  const healthy = input.run ? null : await probe(input.port, input.probeMs ?? 15_000);
  return { ...base, healthy };
}

export function uninstallHost(input: { tree?: string; env: NodeJS.ProcessEnv; run?: Exec }): { tree: string; plist: string } {
  const name = input.tree || "clfly";
  const run = input.run ?? exec;
  run("launchctl", ["bootout", `${domain()}/${hostLabel(name)}`]);
  const plist = hostPlistPath(name, input.env);
  rmSync(plist, { force: true });
  return { tree: name, plist };
}
