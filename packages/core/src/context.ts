import { resolve } from "node:path";
import type { Context, Meta } from "./types.js";
import { resolveUnderRoot, resolveUnderRoots } from "./fs/resolve-under-root.js";
import { createAsk, readlinePrompter, type Prompter } from "./ask.js";

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
  /** Extra directories a scoped `resolvePath` accepts (MCP `--allow`, `clfly.allow`). */
  allow?: readonly string[];
  /** Answers from `--answer` (default none). */
  answers?: Record<string, string>;
  /** Whether `ask` may prompt (default false: off a terminal it stops for input). */
  interactive?: boolean;
  prompt?: Prompter;
}

/** Build a {@link Context} with `resolvePath` bound to `cwd` / scoping. */
export function createContext(opts: CreateContextOptions): Context {
  const cwd = resolve(opts.cwd);
  const scoped = opts.scoped ?? false;
  const answers = { ...(opts.answers ?? {}) };
  const interactive = opts.interactive ?? false;
  return {
    answers,
    interactive,
    ask: createAsk({ answers, interactive, prompt: opts.prompt ?? readlinePrompter() }),
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
      if (scoped) return opts.allow?.length ? resolveUnderRoots(cwd, opts.allow, userPath) : resolveUnderRoot(cwd, userPath);
      return resolve(cwd, userPath);
    },
  };
}
