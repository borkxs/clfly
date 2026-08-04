import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "mcp/index": "src/mcp/index.ts",
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
