import { ClflyError } from "../errors.js";

/**
 * Map a command path to an MCP tool name.
 *
 * Rules:
 * - A dynamic segment in the middle (`users/:id/show`) is an argument and is dropped.
 * - A trailing dynamic segment (`down/:env`, from `down/[env].ts`) is the child
 *   command, so its name stays (`down_env`) and does not collide with bare `down`.
 * - Remaining segments are sanitized (`[^a-zA-Z0-9_-]` → `_`) and joined with `_`.
 * - Root index (`[]`) is **not** a tool → returns `null`.
 * - Nested index is already represented as the parent path (`users/index` → `["users"]` → `users`).
 *
 * Collisions (two files → same name) hard-fail — see {@link assertUniqueToolNames}.
 */
export function toolNameFromPath(path: string[]): string | null {
  if (path.length === 0) return null;
  const parts: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const segment = path[i]!;
    const dynamic = segment.startsWith(":") || /^\[.+\]$/.test(segment);
    if (dynamic && i !== path.length - 1) continue;
    const label = dynamic ? dynamicLabel(segment) : segment;
    parts.push(label.replace(/[^a-zA-Z0-9_-]/g, "_"));
  }
  if (parts.length === 0) return null;
  return parts.join("_");
}

function dynamicLabel(segment: string): string {
  if (segment.startsWith(":")) return segment.slice(1);
  const match = /^\[(.+)\]$/.exec(segment);
  return match?.[1] ?? segment;
}

export interface ToolNameSource {
  /** Manifest-style path (`:id` for dynamics). */
  path: string[];
  /** Absolute or repo-relative file path for error messages. */
  file: string;
}

/**
 * Ensure every projectable command has a unique tool name.
 * Root-index entries (`toolNameFromPath` → null) are skipped.
 * On collision, throws naming both files and the contested name.
 */
export function assertUniqueToolNames(sources: ToolNameSource[]): void {
  const byName = new Map<string, ToolNameSource>();
  for (const src of sources) {
    const name = toolNameFromPath(src.path);
    if (name === null) continue;
    const prev = byName.get(name);
    if (prev) {
      throw new ClflyError(
        `MCP tool name collision: "${name}"\n` +
          `  ${prev.file}  (path: ${formatPath(prev.path)})\n` +
          `  ${src.file}  (path: ${formatPath(src.path)})\n` +
          `Rename one of the command files so tool names stay stable and order-independent.`,
      );
    }
    byName.set(name, src);
  }
}

function formatPath(path: string[]): string {
  if (path.length === 0) return "(root index)";
  return path.join("/");
}
