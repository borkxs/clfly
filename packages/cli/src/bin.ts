import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createCli } from "@clfly/core";
import { renderInstructions } from "./hub/hub.js";
import { hubIndex } from "./hub/run.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const cli = createCli({
  name: "clfly",
  version: pkg.version,
  commandsDir: new URL("./commands", import.meta.url),
  packageJsonPath: fileURLToPath(new URL("../package.json", import.meta.url)),
  // The hub's keyword listing: what every linked tree can do, in a few hundred tokens.
  mcpInstructions: async () => renderInstructions(await hubIndex(process.env)),
});

try {
  const result = await cli.run(process.argv.slice(2));
  process.exitCode ??= result.exitCode;
} catch (err: unknown) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
