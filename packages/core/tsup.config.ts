import { defineConfig } from "tsup";

const shared = {
  format: ["esm"] as const,
  dts: true,
  sourcemap: true,
  target: "node20" as const,
  splitting: false,
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/index.ts"],
    clean: true,
  },
  {
    ...shared,
    entry: ["src/cli.ts"],
    clean: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
