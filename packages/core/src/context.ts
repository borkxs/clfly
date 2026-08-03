import { resolve } from "node:path";
import type { Context, Meta } from "./types.js";
import { resolveUnderRoot } from "./fs/resolve-under-root.js";

export interface CreateContextOptions {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  commandPath: string[];
  meta?: Meta;
  json: boolean;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  /** Jail {@link Context.resolvePath} under `cwd` (MCP `--root`). */
  scoped?: boolean;
}

/** Build a {@link Context} with `resolvePath` bound to `cwd` / scoping. */
export function createContext(opts: CreateContextOptions): Context {
  const cwd = resolve(opts.cwd);
  const scoped = opts.scoped ?? false;
  return {
    argv: opts.argv,
    cwd,
    env: opts.env,
    commandPath: opts.commandPath,
    meta: opts.meta ?? {},
    json: opts.json,
    stdout: opts.stdout,
    stderr: opts.stderr,
    scoped,
    resolvePath(userPath: string) {
      if (scoped) return resolveUnderRoot(cwd, userPath);
      return resolve(cwd, userPath);
    },
  };
}
