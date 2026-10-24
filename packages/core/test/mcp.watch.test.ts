import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp/server.js";

const here = fileURLToPath(new URL(".", import.meta.url));

function commandSource(description: string): string {
  return `import { z } from "zod";
export const meta = { description: ${JSON.stringify(description)} };
export const args = z.object({});
export default async function () {
  return { ok: true };
}
`;
}

describe("mcp serve dev watch", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits tools/list_changed and lists a command added after start", async () => {
    const dir = mkdtempSync(join(here, "tmp-watch-"));
    dirs.push(dir);
    const commands = join(dir, "commands");
    mkdirSync(commands);
    writeFileSync(join(commands, "ping.ts"), commandSource("ping"));

    const server = await createMcpServer({
      name: "watch-test",
      commandsDir: commands,
      root: dir,
    });
    const client = new Client({ name: "watch-test", version: "0.0.0" });
    let changed = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      changed += 1;
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const before = (await client.listTools()).tools.map((tool) => tool.name);
    expect(before).toContain("ping");
    expect(before).not.toContain("extra");

    writeFileSync(join(commands, "extra.ts"), commandSource("added live"));

    const deadline = Date.now() + 3000;
    while (changed === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(changed).toBeGreaterThan(0);
    const after = (await client.listTools()).tools.map((tool) => tool.name);
    expect(after).toContain("extra");

    await client.close();
    await server.close();
  }, 10_000);
});
