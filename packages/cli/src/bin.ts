import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createCli } from "@clfly/core";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const cli = createCli({
  name: "clfly",
  version: pkg.version,
  commandsDir: new URL("./commands", import.meta.url),
  packageJsonPath: fileURLToPath(new URL("../package.json", import.meta.url)),
});

try {
  const result = await cli.run(process.argv.slice(2));
  process.exitCode ??= result.exitCode;
} catch (err: unknown) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
