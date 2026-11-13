import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { mintSessionId } from "../session/index.js";
import type { CreateMcpOptions } from "./project.js";
import { createMcpServer } from "./server.js";

export interface McpHttpOptions {
  /** TCP port; 0 picks a free one (tests). */
  port: number;
  /** Bind address. Loopback only by default: no auth, so never bind it wider. */
  host?: string;
  /** Path the MCP endpoint answers on. */
  path?: string;
  /** Close a client session after this long without a request (default 12 h). */
  idleMs?: number;
}

export interface McpHttpHandle {
  http: HttpServer;
  url: string;
  /** Live client sessions (one MCP Server each, all in this process). */
  sessions: () => number;
  close: () => Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: Server;
  seen: number;
}

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });

/**
 * Serve the command tree over MCP Streamable HTTP, so every agent session
 * shares one long-lived process instead of spawning its own stdio server.
 * Each client session gets its own MCP Server (and spool session id); they
 * share this process, its tool list and anything the commands keep in memory.
 */
export async function serveMcpHttp(options: CreateMcpOptions, http: McpHttpOptions): Promise<McpHttpHandle> {
  const host = http.host ?? "127.0.0.1";
  const path = http.path ?? "/mcp";
  const idleMs = http.idleMs ?? 12 * 60 * 60 * 1000;
  const sessions = new Map<string, Session>();

  const json = (res: import("node:http").ServerResponse, status: number, message: string) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ name: options.name, sessions: sessions.size }));
        return;
      }
      if (url.pathname !== path) return json(res, 404, `Not found; the MCP endpoint is ${path}`);

      const header = req.headers["mcp-session-id"];
      const sid = Array.isArray(header) ? header[0] : header;
      const body = req.method === "POST" ? await readBody(req) : undefined;

      let session = sid ? sessions.get(sid) : undefined;
      if (!session) {
        if (sid) return json(res, 404, "Unknown MCP session; initialize again");
        if (req.method !== "POST" || !isInitializeRequest(body)) {
          return json(res, 400, "No MCP session: the first request must be initialize");
        }
        const spoolSession = mintSessionId();
        const mcp = await createMcpServer({ ...options, sessionId: spoolSession });
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => spoolSession,
          enableDnsRebindingProtection: true,
          allowedHosts: [`127.0.0.1:${port()}`, `localhost:${port()}`, `[::1]:${port()}`],
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, server: mcp, seen: Date.now() });
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await mcp.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }
      session.seen = Date.now();
      await session.transport.handleRequest(req, res, body);
      if (req.method === "DELETE") sessions.delete(sid!);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`clfly: mcp http request failed: ${message}\n`);
      if (!res.headersSent) json(res, 500, message);
    }
  });

  const port = () => (server.address() as AddressInfo | null)?.port ?? http.port;

  // Clients that vanish without DELETE (killed sessions) are closed once idle.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - idleMs;
    for (const [id, s] of sessions) {
      if (s.seen < cutoff) {
        sessions.delete(id);
        void s.server.close();
      }
    }
  }, Math.min(idleMs, 10 * 60 * 1000));
  sweep.unref();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(http.port, host, () => resolve());
  });

  return {
    http: server,
    url: `http://${host.includes(":") ? `[${host}]` : host}:${port()}${path}`,
    sessions: () => sessions.size,
    close: async () => {
      clearInterval(sweep);
      for (const s of sessions.values()) await s.server.close();
      sessions.clear();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
