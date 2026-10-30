import { join } from "node:path";
import { ClflyError } from "@clfly/core";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { userHome } from "./paths.js";

export const HARNESSES = [
  "claude-code",
  "cursor",
  "vscode",
  "codex",
  "gemini",
  "claude-desktop",
] as const;
export type Harness = (typeof HARNESSES)[number];
export type Scope = "project" | "user";

/** The one record every harness projection is built from. */
export interface ServerRecord {
  name: string;
  command: string;
  args: string[];
}

function appData(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const home = userHome(env);
  if (platform === "darwin") return join(home, "Library", "Application Support");
  if (platform === "win32") return env.APPDATA?.trim() || join(home, "AppData", "Roaming");
  return env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
}

export function harnessFile(input: {
  harness: Harness;
  scope: Scope;
  project: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}): string {
  const { harness, scope, project, env, platform } = input;
  const home = userHome(env);
  const user = scope === "user";
  switch (harness) {
    case "claude-code":
      return user ? join(home, ".claude.json") : join(project, ".mcp.json");
    case "cursor":
      return join(user ? home : project, ".cursor", "mcp.json");
    case "vscode":
      return user
        ? join(appData(env, platform), "Code", "User", "mcp.json")
        : join(project, ".vscode", "mcp.json");
    case "codex":
      return join(user ? home : project, ".codex", "config.toml");
    case "gemini":
      return join(user ? home : project, ".gemini", "settings.json");
    case "claude-desktop":
      if (!user) throw new ClflyError("claude-desktop has no project scope; pass --scope user", 2);
      return join(appData(env, platform), "Claude", "claude_desktop_config.json");
  }
}

/**
 * Returns the file text with `record.name` set (or removed). Every other key is
 * kept. Throws exit 1 when the existing text is not an object.
 */
export function projectFile(input: {
  harness: Harness;
  file: string;
  before: string;
  record: ServerRecord;
  remove: boolean;
}): string {
  const { harness, file, before, record, remove } = input;
  if (harness === "codex") return projectToml(file, before, record, remove);

  let doc: Record<string, unknown> = {};
  if (before.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(before);
    } catch (err) {
      throw new ClflyError(`${file} is not JSON: ${err instanceof Error ? err.message : err}`, 1);
    }
    if (!isObject(parsed)) throw new ClflyError(`${file} is not a JSON object`, 1);
    doc = parsed;
  }
  const key = harness === "vscode" ? "servers" : "mcpServers";
  const servers = doc[key] ?? {};
  if (!isObject(servers)) throw new ClflyError(`${file}: "${key}" is not an object`, 1);
  if (remove) {
    if (!(record.name in servers)) return before;
    delete servers[record.name];
  } else {
    servers[record.name] =
      harness === "vscode"
        ? { type: "stdio", command: record.command, args: record.args }
        : { command: record.command, args: record.args };
  }
  doc[key] = servers;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function projectToml(file: string, before: string, record: ServerRecord, remove: boolean): string {
  let doc: Record<string, unknown>;
  try {
    doc = parseToml(before) as Record<string, unknown>;
  } catch (err) {
    throw new ClflyError(`${file} is not TOML: ${err instanceof Error ? err.message : err}`, 1);
  }
  const servers = doc.mcp_servers ?? {};
  if (!isObject(servers)) throw new ClflyError(`${file}: mcp_servers is not a table`, 1);
  if (remove) {
    if (!(record.name in servers)) return before;
    delete servers[record.name];
  } else {
    servers[record.name] = { command: record.command, args: record.args };
  }
  doc.mcp_servers = servers;
  return `${stringifyToml(doc).trimEnd()}\n`;
}

/**
 * The harness CLI that replaces the file edit on apply, when it is on PATH.
 * Each entry is run in order; a failing `remove` before an `add` is ignored.
 */
export function delegateArgv(input: {
  harness: Harness;
  scope: Scope;
  record: ServerRecord;
  remove: boolean;
}): { bin: string; steps: Array<{ args: string[]; mayFail: boolean }> } | null {
  const { harness, scope, record, remove } = input;
  const command = [record.command, ...record.args];
  if (harness === "claude-code") {
    const rm = { args: ["mcp", "remove", record.name, "--scope", scope], mayFail: !remove };
    if (remove) return { bin: "claude", steps: [rm] };
    return {
      bin: "claude",
      steps: [
        rm,
        {
          args: ["mcp", "add", "--transport", "stdio", "--scope", scope, record.name, "--", ...command],
          mayFail: false,
        },
      ],
    };
  }
  if (harness === "codex" && scope === "user") {
    const rm = { args: ["mcp", "remove", record.name], mayFail: !remove };
    if (remove) return { bin: "codex", steps: [rm] };
    return {
      bin: "codex",
      steps: [rm, { args: ["mcp", "add", record.name, "--", ...command], mayFail: false }],
    };
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
