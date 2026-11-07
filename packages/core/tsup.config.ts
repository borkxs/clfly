import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "mcp/index": "src/mcp/index.ts",
    // Dependency-free picker helpers for launchers and UIs that bundle them.
    "complete/index": "src/complete/index.ts",
    // Typed rows matcher (acceptorsFor, rowChoices) for the same consumers.
    "rows/index": "src/rows/index.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  target: "node20",
  // Dynamic `import("./mcp/server.js")` from run.ts must stay a real chunk
  // so the main entry never loads the MCP SDK until `mcp serve`.
  splitting: true,
  external: [/^@modelcontextprotocol\//],
  clean: true,
});
