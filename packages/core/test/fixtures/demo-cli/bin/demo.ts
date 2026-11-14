#!/usr/bin/env node
import { fileURLToPath } from "node:url";
// Relative, so it runs wherever this package lives (no @clfly/core in node_modules needed).
import { createCli } from "../../../../src/index.js";

const cli = createCli({
  name: "demo",
  commandsDir: new URL("../commands", import.meta.url),
  packageJsonPath: fileURLToPath(new URL("../package.json", import.meta.url)),
});

const result = await cli.run(process.argv.slice(2));
process.exitCode = result.exitCode;
