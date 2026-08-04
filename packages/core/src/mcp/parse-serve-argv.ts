import { ClflyError } from "../errors.js";

/**
 * Parse framework-owned `mcp serve` argv flags.
 * Strips `--help`/`-h`/`--version`/`-V`/`--json`/`--` from the path tokens.
 */
export function isMcpServeArgv(argv: string[]): boolean {
  const tokens = pathTokens(argv);
  return tokens[0] === "mcp" && tokens[1] === "serve";
}

export function isMcpArgv(argv: string[]): boolean {
  const tokens = argv.filter((t) => !t.startsWith("-") && t !== "--");
  return tokens[0] === "mcp";
}

export interface McpServeFlags {
  /** Absolute or relative root directory for scoped filesystem access. */
  root?: string;
  help: boolean;
}

/** Extract `--root` (and help) from `mcp serve` argv. */
export function parseMcpServeFlags(argv: string[]): McpServeFlags {
  let root: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "--help" || t === "-h") {
      help = true;
      continue;
    }
    if (t === "--root") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        throw new ClflyError(
          "mcp serve --root requires a directory argument",
          2,
        );
      }
      root = next;
      i++;
      continue;
    }
    if (t.startsWith("--root=")) {
      root = t.slice("--root=".length);
      if (!root) {
        throw new ClflyError(
          "mcp serve --root requires a directory argument",
          2,
        );
      }
    }
  }

  return { root, help };
}

function pathTokens(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (
      t === "--" ||
      t === "--help" ||
      t === "-h" ||
      t === "--version" ||
      t === "-V" ||
      t === "--json"
    ) {
      continue;
    }
    if (t === "--root") {
      i++; // skip value
      continue;
    }
    if (t.startsWith("--root=")) continue;
    out.push(t);
  }
  return out;
}
