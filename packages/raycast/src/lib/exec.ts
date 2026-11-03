import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { getPreferenceValues } from "@raycast/api";
import type { Tree } from "./model";

interface Preferences {
  extraPath?: string;
  clflyBin?: string;
  searchLimit?: string;
}

export function preferences(): Preferences {
  return getPreferenceValues<Preferences>();
}

/**
 * Raycast does not load the shell profile, so node (nvm), pnpm's bin dir,
 * and Homebrew are added by hand. The preference goes first.
 */
function searchPath(): string {
  const home = homedir();
  const dirs = [
    ...(preferences().extraPath ?? "").split(":"),
    ...nvmBins(home),
    join(home, "Library", "pnpm"),
    join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(process.env.PATH ?? "").split(delimiter),
    "/usr/bin",
    "/bin",
  ].filter(Boolean);
  return [...new Set(dirs)].join(delimiter);
}

/** Newest nvm node first. */
function nvmBins(home: string): string[] {
  const dir = join(home, ".nvm", "versions", "node");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((v) => join(dir, v, "bin"));
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Parsed stdout when it is JSON. */
  json?: unknown;
  /** Message from the `--json` error body on stderr, or the last stderr line. */
  error?: string;
  ms: number;
}

/**
 * Run an executable with an argv array — never through a shell. A `.js` /
 * `.mjs` / `.cjs` bin runs through node so its mode bits do not matter.
 */
export function execArgv(
  bin: string,
  argv: string[],
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RunResult> {
  const viaNode = /\.(c|m)?js$/.test(bin);
  const file = viaNode ? "node" : bin;
  const args = viaNode ? [bin, ...argv] : argv;
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: homedir(),
        env: { ...process.env, PATH: searchPath(), NO_COLOR: "1", FORCE_COLOR: "0" },
        maxBuffer: 64 * 1024 * 1024,
        timeout: opts.timeoutMs ?? 10 * 60 * 1000,
        signal: opts.signal,
      },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
        const code = e ? (typeof e.code === "number" ? e.code : 1) : 0;
        const out: RunResult = { code, stdout, stderr, ms: Date.now() - started };
        const text = stdout.trim();
        if (text) {
          try {
            out.json = JSON.parse(text);
          } catch {
            /* not JSON: shown as text */
          }
        }
        if (code !== 0) out.error = errorMessage(stderr) ?? e?.message ?? `exited ${code}`;
        resolve(out);
      },
    );
  });
}

/** `--json` errors are `{ "error": { "message" } }` on stderr, possibly after log lines. */
function errorMessage(stderr: string): string | undefined {
  const start = stderr.indexOf("{");
  if (start >= 0) {
    try {
      const body = JSON.parse(stderr.slice(start)) as { error?: { message?: string } };
      if (body.error?.message) return body.error.message;
    } catch {
      /* fall through */
    }
  }
  return stderr.trim().split("\n").filter(Boolean).pop();
}

export function runTree(tree: Pick<Tree, "bin">, argv: string[], opts?: { signal?: AbortSignal }) {
  return execArgv(tree.bin, argv, opts);
}

/** Every linked tree's routes, from `clfly manifest --json`. */
export async function fetchTrees(): Promise<Tree[]> {
  const bin = preferences().clflyBin?.trim() || "clfly";
  const res = await execArgv(bin, ["manifest", "--json"], { timeoutMs: 60_000 });
  if (res.code !== 0 || !res.json) {
    throw new Error(
      `clfly manifest failed: ${res.error ?? "no JSON on stdout"}. ` +
        "It needs @clfly/cli with the manifest command (rebuild packages/cli) and node on the extension's PATH.",
    );
  }
  return (res.json as { trees: Tree[] }).trees;
}
