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
  /** Extra directories tools may resolve paths into (`--allow`, repeatable). */
  allow: string[];
  /** Serve Streamable HTTP on this localhost port instead of stdio (`--http <port>`). */
  http?: number;
  help: boolean;
}

/** Extract `--root`, `--allow` (and help) from `mcp serve` argv. */
export function parseMcpServeFlags(argv: string[]): McpServeFlags {
  let root: string | undefined;
  const allow: string[] = [];
  let help = false;
  let http: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "--help" || t === "-h") {
      help = true;
      continue;
    }
    if (t === "--allow" || t.startsWith("--allow=")) {
      const value = t === "--allow" ? argv[++i] : t.slice("--allow=".length);
      if (!value || value.startsWith("-")) {
        throw new ClflyError("mcp serve --allow requires a directory argument", 2);
      }
      allow.push(value);
      continue;
    }
    if (t === "--http" || t.startsWith("--http=")) {
      const value = t === "--http" ? argv[++i] : t.slice("--http=".length);
      const port = Number(value);
      if (!value || !Number.isInteger(port) || port < 0 || port > 65535) {
        throw new ClflyError("mcp serve --http requires a port number", 2);
      }
      http = port;
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

  return { root, allow, help, ...(http !== undefined ? { http } : {}) };
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
    if (t === "--root" || t === "--allow" || t === "--http") {
      i++; // skip value
      continue;
    }
    if (t.startsWith("--root=") || t.startsWith("--allow=") || t.startsWith("--http=")) continue;
    out.push(t);
  }
  return out;
}
