/**
 * Thin alias for `clfly init` — enables `npm create clfly`.
 * Shares @clfly/cli's init implementation (no second template).
 */
import { runInit } from "@clfly/cli/scaffold";

function parseArgv(argv: string[]): {
  name?: string;
  validator?: "zod" | "valibot" | "arktype";
  pm?: "npm" | "pnpm" | "yarn" | "bun";
  force: boolean;
} {
  let name: string | undefined;
  let validator: "zod" | "valibot" | "arktype" | undefined;
  let pm: "npm" | "pnpm" | "yarn" | "bun" | undefined;
  let force = false;

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok === "--force") {
      force = true;
      continue;
    }
    if (tok === "--validator") {
      validator = argv[++i] as typeof validator;
      continue;
    }
    if (tok.startsWith("--validator=")) {
      validator = tok.slice("--validator=".length) as typeof validator;
      continue;
    }
    if (tok === "--pm") {
      pm = argv[++i] as typeof pm;
      continue;
    }
    if (tok.startsWith("--pm=")) {
      pm = tok.slice("--pm=".length) as typeof pm;
      continue;
    }
    if (tok === "--help" || tok === "-h") {
      process.stdout.write(
        `create-clfly — scaffold a clfly CLI\n\n` +
          `Usage: npm create clfly [name] [-- --validator zod|valibot|arktype] [--pm npm|pnpm|yarn|bun] [--force]\n`,
      );
      process.exit(0);
    }
    if (!tok.startsWith("-") && name === undefined) {
      name = tok;
    }
  }

  return { name, validator, pm, force };
}

const opts = parseArgv(process.argv.slice(2));

try {
  await runInit(opts, {
    cwd: process.cwd(),
    json: false,
    stdout: process.stdout,
    stderr: process.stderr,
  });
  process.exitCode = 0;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(message + "\n");
  const code =
    err && typeof err === "object" && "exitCode" in err
      ? Number((err as { exitCode: number }).exitCode)
      : 1;
  process.exitCode = code || 1;
}
