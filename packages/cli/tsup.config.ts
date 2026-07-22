import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: false,
  target: "node20",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
