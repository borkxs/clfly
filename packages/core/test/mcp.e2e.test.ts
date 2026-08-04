import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp/server.js";
import { listMcpTools } from "../src/mcp/project.js";

const cliCommands = fileURLToPath(
  new URL("../../cli/src/commands", import.meta.url),
);
const demoCommands = fileURLToPath(
  new URL("../../../examples/demo-cli/commands", import.meta.url),
);

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function connectServer(options: Parameters<typeof createMcpServer>[0]) {
  const server = await createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

describe("MCP E2E (in-memory)", () => {
  it("lists init/add tools from clfly command tree", async () => {
    const root = mkdtempSync(join(tmpdir(), "clfly-mcp-e2e-"));
    temps.push(root);
    const client = await connectServer({
      name: "clfly",
      commandsDir: cliCommands,
      root,
      version: "0.0.0",
    });

    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toContain("init");
    expect(names).toContain("add");
    expect(names).not.toContain("index");

    const add = listed.tools.find((t) => t.name === "add")!;
    expect(add.inputSchema).toBeTruthy();
    expect(
      (add.inputSchema as { properties?: Record<string, unknown> }).properties,
    ).toHaveProperty("paths");
  });

  it("calls add under --root and rejects path escapes via init", async () => {
    const root = mkdtempSync(join(tmpdir(), "clfly-mcp-e2e-"));
    temps.push(root);
    // Minimal package.json so add can detect a validator.
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "tmp", dependencies: { zod: "^4" } }),
      "utf8",
    );
    mkdirSync(join(root, "commands"), { recursive: true });

    const client = await connectServer({
      name: "clfly",
      commandsDir: cliCommands,
      root,
      version: "0.0.0",
    });

    const addResult = await client.callTool({
      name: "add",
      arguments: { paths: ["user/list", "user/:id/report"] },
    });
    expect(addResult.isError).toBeFalsy();
    expect(existsSync(join(root, "commands", "user", "list.ts"))).toBe(true);
    expect(
      existsSync(join(root, "commands", "user", "[id]", "report.ts")),
    ).toBe(true);

    const escape = await client.callTool({
      name: "init",
      arguments: { name: "../evil" },
    });
    expect(escape.isError).toBe(true);
    const text = (escape.content as Array<{ type: string; text?: string }>)
      .map((c) => c.text ?? "")
      .join("\n");
    expect(text).toMatch(/escapes root/);
    expect(existsSync(join(dirname(root), "evil"))).toBe(false);
  });

  it("snapshots demo-cli tool names and schemas", async () => {
    const tools = await listMcpTools({
      name: "demo",
      commandsDir: demoCommands,
    });
    const projection = tools
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const snapPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "demo-cli-mcp-tools.json",
    );
    if (process.env.UPDATE_SNAPSHOTS === "1") {
      mkdirSync(dirname(snapPath), { recursive: true });
      writeFileSync(snapPath, `${JSON.stringify(projection, null, 2)}\n`);
    }
    const expected = JSON.parse(readFileSync(snapPath, "utf8"));
    expect(projection).toEqual(expected);
  });
});
