import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; [k: string]: unknown };
}

export interface CallResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/**
 * A line-delimited JSON-RPC client for one tree's `<bin> mcp serve`. The child
 * stays up between calls so a session pays the tree's start-up once.
 */
export class TreeClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private ready: Promise<unknown>;
  private stderrTail = "";
  closed = false;
  readonly bin: string;
  private timeoutMs: number;

  // Plain fields, not parameter properties: Node's type stripping runs only erasable syntax.
  constructor(bin: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 120_000) {
    this.bin = bin;
    this.timeoutMs = timeoutMs;
    this.child = spawn(bin, ["mcp", "serve"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-1000);
    });
    const fail = (why: string) => {
      this.closed = true;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`${bin} mcp serve ${why}${this.stderrTail ? `: ${this.stderrTail.trim()}` : ""}`));
        this.pending.delete(id);
      }
    };
    // A pooled child must not keep a one-shot CLI run alive; pending requests hold
    // the loop open through their timers, and `mcp serve` through its own stdin.
    this.child.unref();
    for (const s of [this.child.stdin, this.child.stdout, this.child.stderr]) (s as unknown as { unref?: () => void }).unref?.();
    this.child.on("error", (err) => fail(`failed to start (${err.message})`));
    this.child.on("exit", (code) => fail(`exited (${code})`));
    this.ready = this.request(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "clfly-hub", version: "0" } },
      20_000,
    ).then((r) => {
      this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      return r;
    });
  }

  private send(msg: unknown) {
    this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private onData(chunk: Buffer) {
    this.buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
      if (!p) continue;
      this.pending.delete(msg.id!);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message ?? "MCP error"));
      else p.resolve(msg.result);
    }
  }

  private request(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error(`${this.bin} mcp serve is not running`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.bin} mcp serve did not answer ${method} within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.ready;
    const r = (await this.request("tools/list", {}, 20_000)) as { tools?: McpToolInfo[] };
    return r.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallResult> {
    await this.ready;
    return (await this.request("tools/call", { name, arguments: args })) as CallResult;
  }

  close() {
    this.closed = true;
    this.child.kill();
  }
}

/** Ask a tree for its tools with a one-shot client. */
export async function listToolsOnce(bin: string, cwd: string, env: NodeJS.ProcessEnv): Promise<McpToolInfo[]> {
  const client = new TreeClient(bin, cwd, env);
  try {
    return await client.listTools();
  } finally {
    client.close();
  }
}

const pool = new Map<string, TreeClient>();
let exitHooked = false;

/** The long-lived client for a tree in this process (restarted if it died). */
export function pooledClient(tree: string, bin: string, cwd: string, env: NodeJS.ProcessEnv): TreeClient {
  const key = `${tree}\0${cwd}`;
  const existing = pool.get(key);
  if (existing && !existing.closed) return existing;
  const client = new TreeClient(bin, cwd, env);
  pool.set(key, client);
  if (!exitHooked) {
    exitHooked = true;
    process.once("exit", () => {
      for (const c of pool.values()) c.close();
    });
  }
  return client;
}
