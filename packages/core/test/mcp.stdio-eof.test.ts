import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { serveMcpStdio } from "../src/mcp/server.js";

const init = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
};

describe("mcp serve over stdio", () => {
  it("answers requests received before EOF, then closes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-eof-"));
    writeFileSync(
      join(dir, "slow.ts"),
      `export const meta = { description: "slow" };
export default async function () {
  await new Promise((r) => setTimeout(r, 200));
  return { done: true };
}
`,
    );
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let out = "";
    stdout.on("data", (d) => (out += String(d)));

    const server = await serveMcpStdio(
      { name: "t", commandsDir: dir, root: dir, env: { ...process.env } },
      { stdin, stdout },
    );
    const closed = new Promise<void>((r) => (server.onclose = r));

    // Requests and EOF in one go, like `echo … | tree mcp serve`.
    stdin.end(
      `${JSON.stringify(init)}\n` +
        `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "slow", arguments: {} } })}\n`,
    );
    await closed;

    const replies = out
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { id: number; result: { structuredContent?: unknown } });
    expect(replies.map((r) => r.id)).toEqual([1, 2]);
    expect(replies[1]!.result.structuredContent).toEqual({ done: true });
    rmSync(dir, { recursive: true, force: true });
  });
});
