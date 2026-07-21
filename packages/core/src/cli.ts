import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildManifest } from "./build/manifest.js";
import { generateCompletions } from "./completions/generate.js";
import type { CompletionShell, Manifest } from "./types.js";
import { ClflyError } from "./errors.js";

/** Allow `clfly build` to import TypeScript command modules. */
async function ensureTsLoader(): Promise<void> {
  try {
    const tsx = await import("tsx/esm/api");
    tsx.register();
  } catch {
    // Optional — plain .js/.mjs commands still work without tsx.
  }
}

async function main(argv: string[]): Promise<number> {
  await ensureTsLoader();
  const [cmd, ...rest] = argv;
  try {
    if (cmd === "build") {
      return await cmdBuild(rest);
    }
    if (cmd === "completions") {
      return await cmdCompletions(rest);
    }
    if (cmd === "--help" || cmd === "-h" || !cmd) {
      printHelp();
      return 0;
    }
    if (cmd === "--version" || cmd === "-V") {
      const { createRequire } = await import("node:module");
      const req = createRequire(import.meta.url);
      const pkg = req("../package.json") as { version: string };
      process.stdout.write(`${pkg.version}\n`);
      return 0;
    }
    throw new ClflyError(`Unknown command: ${cmd}\nRun \`clfly --help\`.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(message + "\n");
    return 1;
  }
}

async function cmdBuild(argv: string[]): Promise<number> {
  const opts = parseFlags(argv);
  const dir = opts.dir ?? opts.commands ?? "commands";
  const out = opts.out ?? ".clfly/manifest.js";
  const result = await buildManifest({
    commandsDir: resolve(dir),
    outFile: resolve(out),
  });
  process.stdout.write(
    `Wrote ${result.routeCount} routes to ${result.outFile}\n`,
  );
  return 0;
}

async function cmdCompletions(argv: string[]): Promise<number> {
  const shell = argv[0] as CompletionShell | undefined;
  if (!shell || !["bash", "zsh", "fish"].includes(shell)) {
    throw new ClflyError("Usage: clfly completions <bash|zsh|fish> [--name NAME] [--dir DIR] [--manifest FILE] [--out FILE]");
  }
  const opts = parseFlags(argv.slice(1));
  const name = opts.name ?? "cli";
  const manifest = await loadOrBuildManifest(opts);
  const script = generateCompletions({ name, manifest, shell });
  if (opts.out) {
    const out = resolve(opts.out);
    mkdirSync(resolve(out, ".."), { recursive: true });
    writeFileSync(out, script, "utf8");
    process.stdout.write(`Wrote ${shell} completions to ${out}\n`);
  } else {
    process.stdout.write(script);
  }
  return 0;
}

async function loadOrBuildManifest(opts: Record<string, string | undefined>): Promise<Manifest> {
  if (opts.manifest) {
    const mod = await import(pathToFileURL(resolve(opts.manifest)).href);
    return (mod.manifest ?? mod.default) as Manifest;
  }
  const dir = opts.dir ?? opts.commands ?? "commands";
  const result = await buildManifest({
    commandsDir: resolve(dir),
    outFile: resolve(opts.outManifest ?? ".clfly/manifest.js"),
  });
  return result.manifest;
}

function parseFlags(argv: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (!tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(`clfly — filesystem CLI framework

Usage:
  clfly build --dir <commands> --out <file>
  clfly completions <bash|zsh|fish> [--name NAME] [--dir DIR | --manifest FILE] [--out FILE]

Options:
  --help, -h       Show help
  --version, -V    Show version
`);
}

const code = await main(process.argv.slice(2));
process.exitCode = code;
