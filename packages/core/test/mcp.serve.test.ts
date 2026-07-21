import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  invokeMcpTool,
  listMcpTools,
  mergePathParamsIntoSchema,
  toolNameFromPath,
} from "../src/mcp/serve.js";
import { createCli } from "../src/run.js";
import { Writable } from "node:stream";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClflyError } from "../src/errors.js";

const demoCommands = fileURLToPath(
  new URL("../../../examples/demo-cli/commands", import.meta.url),
);
const demoPkg = fileURLToPath(
  new URL("../../../examples/demo-cli/package.json", import.meta.url),
);

describe("toolNameFromPath", () => {
  it("maps paths to MCP tool names", () => {
    expect(toolNameFromPath([])).toBe("index");
    expect(toolNameFromPath(["users", "list"])).toBe("users_list");
    expect(toolNameFromPath(["users", ":id", "show"])).toBe("users_show");
  });
});

describe("mergePathParamsIntoSchema", () => {
  it("adds missing path params as required strings", () => {
    const merged = mergePathParamsIntoSchema(
      {
        type: "object",
        properties: { json: { type: "boolean" } },
      },
      ["id"],
    );
    expect(merged.properties?.id).toMatchObject({ type: "string" });
    expect(merged.required).toContain("id");
  });
});

describe("listMcpTools", () => {
  it("projects demo-cli commands to tools with JSON Schema", async () => {
    const tools = await listMcpTools({
      name: "demo",
      commandsDir: demoCommands,
    });
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain("users_list");
    expect(names).toContain("users_show");
    expect(names).toContain("deploy");
    expect(names).toContain("index");

    const list = tools.find((t) => t.name === "users_list")!;
    expect(list.description).toContain("List users");
    expect(list.inputSchema.properties).toHaveProperty("status");
    expect(list.inputSchema.$schema).toBeUndefined();

    const show = tools.find((t) => t.name === "users_show")!;
    expect(show.inputSchema.properties).toHaveProperty("id");
    expect(show.inputSchema.required).toContain("id");
  });

  it("invokes a tool handler and returns JSON text", async () => {
    const tools = await listMcpTools({
      name: "demo",
      commandsDir: demoCommands,
    });
    const list = tools.find((t) => t.name === "users_list")!;
    const result = await invokeMcpTool(
      list,
      { status: "active" },
      { cwd: process.cwd(), env: process.env },
    );
    expect(result.isError).toBeFalsy();
    const text = result.content[0];
    expect(text?.type).toBe("text");
    if (text?.type === "text") {
      const parsed = JSON.parse(text.text) as Array<{ id: string }>;
      expect(parsed[0]?.id).toBe("u_1");
    }
  });
});

describe("mcp serve wiring", () => {
  it("shows mcp help without starting stdio", async () => {
    const out = collectStream();
    const cli = createCli({
      name: "demo",
      commandsDir: demoCommands,
      packageJsonPath: demoPkg,
      stdout: out.stream,
      stderr: collectStream().stream,
    });
    const result = await cli.run(["mcp"]);
    expect(result.exitCode).toBe(0);
    expect(out.text()).toContain("mcp serve");
  });

  it("lists mcp in root --help", async () => {
    const out = collectStream();
    const cli = createCli({
      name: "demo",
      commandsDir: demoCommands,
      packageJsonPath: demoPkg,
      stdout: out.stream,
      stderr: collectStream().stream,
    });
    await cli.run(["--help"]);
    expect(out.text()).toContain("mcp");
  });

  it("hard-errors if commands/mcp collides", () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-mcp-collide-"));
    mkdirSync(join(dir, "mcp"), { recursive: true });
    writeFileSync(
      join(dir, "mcp", "serve.ts"),
      "export default async function () {}",
    );
    expect(() =>
      createCli({ name: "demo", commandsDir: dir }),
    ).toThrow(ClflyError);
    rmSync(dir, { recursive: true, force: true });
  });
});

function collectStream() {
  let data = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      data += String(chunk);
      cb();
    },
  });
  return { stream, text: () => data };
}
