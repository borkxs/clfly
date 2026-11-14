import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { type McpHttpHandle, serveMcpHttp } from "../src/mcp/http.js";
import { parseMcpServeFlags } from "../src/mcp/parse-serve-argv.js";

function tree(): string {
  const dir = mkdtempSync(join(tmpdir(), "clfly-http-"));
  writeFileSync(
    join(dir, "hello.ts"),
    `export const meta = { description: "say hello" };
export default async function () { return { hello: "world", pid: process.pid }; }
`,
  );
  return dir;
}

async function connect(url: string): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

let handle: McpHttpHandle | undefined;
afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

describe("mcp serve --http", () => {
  it("serves two client sessions from one process", async () => {
    const dir = tree();
    handle = await serveMcpHttp({ name: "t", commandsDir: dir, root: dir, env: { ...process.env } }, { port: 0 });
    const a = await connect(handle.url);
    const b = await connect(handle.url);
    expect(handle.sessions()).toBe(2);

    const tools = await a.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("hello");
    const ra = await a.callTool({ name: "hello", arguments: {} });
    const rb = await b.callTool({ name: "hello", arguments: {} });
    const pid = (r: typeof ra) => JSON.parse((r.content as Array<{ text: string }>)[0]!.text).pid;
    expect(pid(ra)).toBe(process.pid);
    expect(pid(rb)).toBe(process.pid);

    await a.close();
    await b.close();
  });

  it("refuses a request whose Host is not loopback", async () => {
    const dir = tree();
    handle = await serveMcpHttp({ name: "t", commandsDir: dir, root: dir, env: { ...process.env } }, { port: 0 });
    const port = new URL(handle.url).port;
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: "/mcp", method: "POST", headers: { host: "evil.example", "content-type": "application/json", accept: "application/json, text/event-stream" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } }));
    });
    expect(status).toBe(403);
    expect(handle.sessions()).toBe(0);
  });

  it("answers /health and rejects non-initialize first requests", async () => {
    const dir = tree();
    handle = await serveMcpHttp({ name: "t", commandsDir: dir, root: dir, env: { ...process.env } }, { port: 0 });
    const base = handle.url.replace(/\/mcp$/, "");
    const health = await fetch(`${base}/health`);
    expect(await health.json()).toEqual({ name: "t", sessions: 0 });
    const bad = await fetch(handle.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(bad.status).toBe(400);
  });

  it("parses --http <port>", () => {
    expect(parseMcpServeFlags(["mcp", "serve", "--http", "4310"]).http).toBe(4310);
    expect(parseMcpServeFlags(["mcp", "serve", "--http=0"]).http).toBe(0);
    expect(() => parseMcpServeFlags(["mcp", "serve", "--http", "x"])).toThrow(/port/);
    expect(parseMcpServeFlags(["mcp", "serve"]).http).toBeUndefined();
  });
});
