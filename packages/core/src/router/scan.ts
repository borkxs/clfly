import { readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { CommandModule, RouteNode, RouteSegment } from "../types.js";
import { ClflyError } from "../errors.js";
import { assertSchemaNoReservedFlags } from "../schema/reserved.js";

const COMMAND_EXTS = new Set([".ts", ".js", ".mts", ".mjs"]);
/** Declaration emit (e.g. add.d.ts) — extname is `.ts`, so skip explicitly. */
const DECLARATION_FILE = /\.d\.(ts|mts|cts|js|mjs|cjs)$/;

export function scanCommandsDir(commandsDir: string): RouteNode {
  const root: RouteNode = {
    segment: null,
    children: new Map(),
  };
  walk(commandsDir, commandsDir, root);
  return root;
}

function isCommandModuleFile(entry: string): boolean {
  if (DECLARATION_FILE.test(entry)) return false;
  return COMMAND_EXTS.has(extname(entry));
}

function walk(commandsDir: string, dir: string, parent: RouteNode): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw new ClflyError(
      `Cannot read commands directory ${dir}: ${err instanceof Error ? err.message : err}`,
    );
  }

  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    const st = statSync(full);

    if (st.isDirectory()) {
      const seg = parseSegment(entry);
      const key = segmentKey(seg);
      let child = parent.children.get(key);
      if (!child) {
        child = { segment: seg, children: new Map() };
        parent.children.set(key, child);
      }
      walk(commandsDir, full, child);
      continue;
    }

    if (!st.isFile()) continue;
    if (!isCommandModuleFile(entry)) continue;
    const ext = extname(entry);
    const name = basename(entry, ext);

    if (name === "index") {
      if (parent.commandFile) {
        throw new ClflyError(
          `Command path collision: both "${parent.commandFile}" and "${full}" ` +
            `map to the same route. Remove one (nested index vs sibling file).`,
        );
      }
      parent.commandFile = full;
      parent.isIndex = true;
      continue;
    }

    const seg: RouteSegment = { type: "static", name };
    const key = segmentKey(seg);
    let child = parent.children.get(key);
    if (!child) {
      child = { segment: seg, children: new Map() };
      parent.children.set(key, child);
    }
    if (child.commandFile) {
      throw new ClflyError(
        `Command path collision: both "${child.commandFile}" and "${full}" ` +
          `map to the same route. Remove one (nested index vs sibling file).`,
      );
    }
    child.commandFile = full;
  }
}

function parseSegment(dirName: string): RouteSegment {
  const m = /^\[([^\]]+)\]$/.exec(dirName);
  if (m?.[1]) return { type: "dynamic", name: m[1] };
  return { type: "static", name: dirName };
}

function segmentKey(seg: RouteSegment): string {
  return seg.type === "dynamic" ? `:${seg.name}` : seg.name;
}

export async function loadCommandModule(
  filePath: string,
): Promise<CommandModule> {
  const mod = (await import(pathToFileURL(filePath).href)) as CommandModule & {
    default: CommandModule["default"];
  };
  if (typeof mod.default !== "function") {
    throw new ClflyError(
      `Command module ${filePath} must export a default function`,
    );
  }
  return {
    meta: mod.meta,
    args: mod.args,
    positionals: mod.positionals,
    default: mod.default,
  };
}

/** Load module and enforce reserved-flag policy (scan/build-time hard error). */
export async function loadAndValidateCommand(
  filePath: string,
  commandPath: string[],
): Promise<CommandModule> {
  const mod = await loadCommandModule(filePath);
  assertSchemaNoReservedFlags(commandPath, mod.args);
  return mod;
}

/** List all command file paths under a scanned tree (for tests / future build). */
export function listCommandFiles(
  node: RouteNode,
  prefix: string[] = [],
): Array<{ path: string[]; file: string }> {
  const out: Array<{ path: string[]; file: string }> = [];
  if (node.commandFile) {
    out.push({ path: prefix, file: node.commandFile });
  }
  for (const child of node.children.values()) {
    const seg = child.segment;
    if (!seg) continue;
    const next =
      seg.type === "dynamic" ? [...prefix, `[${seg.name}]`] : [...prefix, seg.name];
    out.push(...listCommandFiles(child, next));
  }
  return out;
}

export function commandPathLabel(
  commandsDir: string,
  filePath: string,
): string[] {
  const rel = relative(commandsDir, filePath).replace(/\\/g, "/");
  const noExt = rel.replace(/\.[^.]+$/, "");
  const parts = noExt.split("/").filter(Boolean);
  if (parts.at(-1) === "index") parts.pop();
  return parts.map((p) => {
    const m = /^\[([^\]]+)\]$/.exec(p);
    return m?.[1] ? `<${m[1]}>` : p;
  });
}
