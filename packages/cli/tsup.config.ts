import { defineConfig } from "tsup";

const shared = {
  format: ["esm"] as const,
  dts: true,
  sourcemap: true,
  target: "node20" as const,
  splitting: false,
  external: ["@clfly/core", "zod"],
};

export default defineConfig([
  {
    ...shared,
    entry: { bin: "src/bin.ts" },
    clean: true,
    dts: false,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    ...shared,
    entry: {
      "commands/init": "src/commands/init.ts",
      "commands/add": "src/commands/add.ts",
      "commands/build": "src/commands/build.ts",
      "commands/completions": "src/commands/completions.ts",
      "scaffold/index": "src/scaffold/index.ts",
    },
    clean: false,
  },
]);
