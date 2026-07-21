#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { createCli } from "@clfly/core";

const cli = createCli({
  name: "demo",
  commandsDir: new URL("../commands", import.meta.url),
  packageJsonPath: fileURLToPath(new URL("../package.json", import.meta.url)),
});

const result = await cli.run(process.argv.slice(2));
process.exitCode = result.exitCode;
