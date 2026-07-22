import { createRequire } from "node:module";

const REPO_URL = "https://github.com/borkxs/clfly";

function readVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json") as { version: string };
  return pkg.version;
}

function helpText(): string {
  return `clfly — File-based routing for CLIs. Write a folder of functions — get a command-line tool, --help, shell completions, and an MCP server from the same tree.

This is a pre-release build (@clfly/cli). The real CLI lands soon — watch the repo:
  ${REPO_URL}

Commands (coming soon):
  build
  completions
  mcp serve

Options:
  --help, -h       Show help
  --version, -V    Show version
`;
}

function main(argv: string[]): number {
  const [cmd] = argv;

  if (cmd === "--version" || cmd === "-V") {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }

  if (cmd === "--help" || cmd === "-h" || cmd === undefined) {
    process.stdout.write(helpText());
    return 0;
  }

  process.stderr.write(`unknown command: ${cmd}\n`);
  process.stdout.write(helpText());
  return 2;
}

process.exitCode = main(process.argv.slice(2));
