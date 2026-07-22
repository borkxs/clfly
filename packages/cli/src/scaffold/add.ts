import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  ClflyError,
  assertUniqueToolNames,
  listCommandFiles,
  scanCommandsDir,
  toolNameFromPath,
  type Context,
} from "@clfly/core";
import { readProjectValidator } from "./detect.js";
import { renderCommandStub } from "./template.js";

export interface AddOptions {
  paths: string[];
  force?: boolean;
  output?: boolean;
  /** Commands directory relative to cwd (default: commands). */
  commandsDir?: string;
}

export interface AddResult {
  created: string[];
}

interface PlannedFile {
  input: string;
  /** Manifest-style path (`:id`). */
  manifestPath: string[];
  /** Relative path from cwd, e.g. commands/user/[id]/report.ts */
  relFile: string;
  absFile: string;
  toolName: string | null;
}

export async function runAdd(
  opts: AddOptions,
  ctx: Pick<Context, "cwd" | "stdout" | "stderr" | "json">,
): Promise<AddResult> {
  const paths = opts.paths ?? [];
  if (paths.length === 0) {
    throw new ClflyError("add requires at least one path (e.g. user/:id/report)", 2);
  }

  const commandsDir = resolve(ctx.cwd, opts.commandsDir ?? "commands");
  const force = opts.force ?? false;
  const withOutput = opts.output ?? false;
  const validator = readProjectValidator(ctx.cwd);

  const errors: string[] = [];
  const planned: PlannedFile[] = [];

  for (const input of paths) {
    try {
      const parsed = parseCommandPathDsl(input);
      const relFile = join("commands", ...parsed.diskSegments) + ".ts";
      const absFile = resolve(ctx.cwd, relFile);
      const toolName = toolNameFromPath(parsed.manifestPath);
      planned.push({
        input,
        manifestPath: parsed.manifestPath,
        relFile: relFile.replace(/\\/g, "/"),
        absFile,
        toolName,
      });
    } catch (err) {
      errors.push(
        `${input}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Exists / reserved checks
  for (const p of planned) {
    if (p.manifestPath[0] === "mcp") {
      errors.push(
        `${p.input}: top-level "mcp" is reserved for the MCP transport`,
      );
    }
    if (existsSync(p.absFile) && !force) {
      errors.push(
        `${p.input}: already exists at ${p.relFile} (pass --force to overwrite)`,
      );
    }
  }

  // Tool-name collisions within batch + against existing tree
  if (existsSync(commandsDir)) {
    try {
      const existing = listCommandFiles(scanCommandsDir(commandsDir)).map((e) => ({
        path: e.path.map((seg) => {
          const m = /^\[([^\]]+)\]$/.exec(seg);
          return m?.[1] ? `:${m[1]}` : seg;
        }),
        file: relative(ctx.cwd, e.file).replace(/\\/g, "/") || e.file,
      }));
      const batch = planned
        .filter((p) => p.toolName !== null)
        .map((p) => ({
          path: p.manifestPath,
          file: p.relFile,
        }));
      try {
        assertUniqueToolNames([...existing, ...batch]);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  } else {
    try {
      assertUniqueToolNames(
        planned
          .filter((p) => p.toolName !== null)
          .map((p) => ({ path: p.manifestPath, file: p.relFile })),
      );
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // Root index as add target: allowed on disk, but warn it's not an MCP tool
  for (const p of planned) {
    if (p.toolName === null && p.manifestPath.length === 0) {
      // adding commands/index.ts — fine, not a tool
    }
  }

  if (errors.length > 0) {
    throw new ClflyError(
      `add validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
      2,
    );
  }

  const created: string[] = [];
  for (const p of planned) {
    mkdirSync(dirname(p.absFile), { recursive: true });
    const description =
      p.manifestPath.length === 0
        ? "Root command"
        : p.manifestPath.filter((s) => !s.startsWith(":")).join(" ") ||
          p.input;
    writeFileSync(
      p.absFile,
      renderCommandStub({ description, validator, withOutput }),
      "utf8",
    );
    created.push(p.relFile);
  }

  if (!ctx.json) {
    for (const c of created) ctx.stdout.write(`${c}\n`);
  }

  return { created };
}

export interface ParsedCommandPath {
  /** Segments for disk: static names and `[param]` dirs; last is file basename. */
  diskSegments: string[];
  /** Manifest path with `:param`. */
  manifestPath: string[];
}

/**
 * Parse add DSL. Primary form `:param`; literal `[param]` also accepted.
 * Both become `[param]` directories on disk.
 */
export function parseCommandPathDsl(input: string): ParsedCommandPath {
  const trimmed = input.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    throw new Error("empty path");
  }
  if (trimmed.includes("\\")) {
    throw new Error("use / as the path separator");
  }

  const rawParts = trimmed.split("/").filter(Boolean);
  if (rawParts.length === 0) throw new Error("empty path");

  const diskSegments: string[] = [];
  const manifestPath: string[] = [];

  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i]!;
    const dynamic = parseDynamicSegment(part);
    if (dynamic) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dynamic)) {
        throw new Error(
          `invalid param name "${dynamic}" (need identifier: [a-zA-Z_][a-zA-Z0-9_]*)`,
        );
      }
      if (i === rawParts.length - 1) {
        throw new Error(
          `path cannot end with a dynamic segment (got ${part}); add a command name after it`,
        );
      }
      diskSegments.push(`[${dynamic}]`);
      manifestPath.push(`:${dynamic}`);
      continue;
    }

    if (part === "." || part === ".." || part.includes("..")) {
      throw new Error(`invalid segment "${part}"`);
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(part)) {
      throw new Error(
        `invalid segment "${part}" (use letters, digits, _ or -)`,
      );
    }
    diskSegments.push(part);
    manifestPath.push(part);
  }

  // `index` leaf → index.ts; manifest path drops the index segment (root → []).
  if (manifestPath.at(-1) === "index") {
    manifestPath.pop();
  }

  return { diskSegments, manifestPath };
}

function parseDynamicSegment(part: string): string | null {
  const colon = /^:([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(part);
  if (colon?.[1]) return colon[1];
  const bracket = /^\[([^\]]+)\]$/.exec(part);
  if (bracket?.[1]) return bracket[1];
  return null;
}
