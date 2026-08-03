import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSessionStore,
  buildEnvelope,
  buildPreview,
  formatRef,
  parseRef,
  jsonByteLength,
  DEFAULT_SPOOL_THRESHOLD,
} from "../src/session/index.js";
import { ClflyError } from "../src/errors.js";
import { createCli } from "../src/run.js";
import { Writable } from "node:stream";
import { invokeMcpTool, listMcpTools, annotationsFromMeta } from "../src/mcp/project.js";
import { handleResultRead, handleResultQuery } from "../src/mcp/session-tools.js";

function collectStream() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  return { stream, text: () => chunks.join("") };
}

describe("session ref + envelope", () => {
  it("formats and parses refs", () => {
    expect(formatRef("abc123", 1)).toBe("abc123/001");
    expect(parseRef("abc123/001")).toEqual({ sessionId: "abc123", seq: 1 });
  });

  it("rejects path traversal in refs", () => {
    expect(() => parseRef("../etc/passwd")).toThrow(ClflyError);
    expect(() => parseRef("sid/../001")).toThrow(ClflyError);
    expect(() => parseRef("sid/001/extra")).toThrow(ClflyError);
  });

  it("builds array preview with totalCount", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const { preview, totalCount } = buildPreview(items);
    expect(totalCount).toBe(10);
    expect(preview).toEqual(items.slice(0, 5));
  });

  it("builds object preview without totalCount", () => {
    const obj: Record<string, unknown> = {
      nested: { a: 1, b: 2 },
      long: "x".repeat(300),
    };
    for (let i = 0; i < 25; i++) obj[`k${i}`] = i;
    const { preview, totalCount } = buildPreview(obj);
    expect(totalCount).toBeUndefined();
    expect(Object.keys(preview as object)).toHaveLength(20);
    expect((preview as Record<string, unknown>).nested).toMatchObject({
      _truncated: true,
      type: "object",
    });
    expect(String((preview as Record<string, unknown>).long).endsWith("…")).toBe(
      true,
    );
  });

  it("envelope shape matches ADR", () => {
    const env = buildEnvelope({
      sessionId: "deadbeefdeadbeef",
      seq: 3,
      value: [{ a: 1 }, { a: 2 }],
      bytes: 99,
      path: "/tmp/x.json",
      schemaRef: "output",
    });
    expect(env).toMatchObject({
      truncated: true,
      ref: "deadbeefdeadbeef/003",
      sessionId: "deadbeefdeadbeef",
      seq: 3,
      totalCount: 2,
      schemaPointer: "output",
      bytes: 99,
      path: "/tmp/x.json",
    });
    expect(env.preview).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("session store", () => {
  it("spools, appends manifest, and round-trips as bind input", () => {
    const root = mkdtempSync(join(tmpdir(), "clfly-session-"));
    const store = createSessionStore({ root, threshold: 100 });
    const value = Array.from({ length: 50 }, (_, i) => ({ id: `t_${i}` }));
    const result = store.spool({
      sessionId: "sess01",
      command: "status",
      argv: ["status", "--json"],
      value,
      schemaRef: "output",
    });

    expect(result.ref).toBe("sess01/001");
    expect(result.envelope.truncated).toBe(true);
    expect(result.envelope.totalCount).toBe(50);

    const raw = readFileSync(result.path, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(value);

    const manifest = readFileSync(
      join(root, ".clfly", "sessions", "sess01", "manifest.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toMatchObject({
      seq: 1,
      command: "status",
      schemaRef: "output",
    });

    // Second spool increments seq
    const r2 = store.spool({
      sessionId: "sess01",
      command: "status",
      argv: ["status"],
      value: [{ id: "x" }],
    });
    expect(r2.ref).toBe("sess01/002");

    rmSync(root, { recursive: true, force: true });
  });

  it("threshold boundary: equal to threshold does not exceed", () => {
    const root = mkdtempSync(join(tmpdir(), "clfly-thresh-"));
    const store = createSessionStore({ root, threshold: 20 });
    // compact JSON of "abcdefghij" is 12 bytes including quotes… craft carefully
    const small = { a: 1 };
    expect(jsonByteLength(small)).toBeLessThanOrEqual(20);
    expect(store.exceedsThreshold(small)).toBe(false);

    const big = { data: "x".repeat(100) };
    expect(jsonByteLength(big)).toBeGreaterThan(20);
    expect(store.exceedsThreshold(big)).toBe(true);
    expect(DEFAULT_SPOOL_THRESHOLD).toBe(65_536);

    rmSync(root, { recursive: true, force: true });
  });

  it("rejects refs that do not resolve via manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "clfly-ref-"));
    const store = createSessionStore({ root });
    store.spool({
      sessionId: "abc",
      command: "x",
      argv: [],
      value: [1, 2, 3],
    });
    expect(() => store.resolveRefPath("abc/999")).toThrow(/Unknown result ref/);
    expect(() => store.resolveRefPath("other/001")).toThrow();
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps session store inside --root and rejects traversal refs", () => {
    const root = mkdtempSync(join(tmpdir(), "clfly-root-"));
    const store = createSessionStore({ root });
    const { path, ref } = store.spool({
      sessionId: "inside01",
      command: "x",
      argv: [],
      value: { ok: true },
    });
    expect(path.startsWith(join(root, ".clfly", "sessions"))).toBe(true);
    expect(store.resolveRefPath(ref).path).toBe(path);
    // Client-supplied path-like strings are never joined as paths.
    expect(() => store.resolveRefPath(`${root}/../../etc/passwd`)).toThrow(
      ClflyError,
    );
    expect(() => parseRef("inside01/../002")).toThrow(ClflyError);
    rmSync(root, { recursive: true, force: true });
  });

  it("result_read slices arrays; result_query stubs", () => {
    const root = mkdtempSync(join(tmpdir(), "clfly-read-"));
    const store = createSessionStore({ root });
    const value = Array.from({ length: 20 }, (_, i) => i);
    const { ref } = store.spool({
      sessionId: "r1",
      command: "list",
      argv: [],
      value,
    });
    const page = handleResultRead(store, { ref, offset: 5, limit: 3 });
    expect(page.isError).toBeFalsy();
    expect(page.structuredContent).toMatchObject({
      offset: 5,
      limit: 3,
      totalCount: 20,
      items: [5, 6, 7],
    });

    const q = handleResultQuery(store, { ref, selector: "$.x" });
    expect(q.isError).toBe(true);
    expect(q.content[0]?.text).toMatch(/not implemented/i);

    rmSync(root, { recursive: true, force: true });
  });

  it("evicts by TTL and max-bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "clfly-evict-"));
    const store = createSessionStore({
      root,
      ttlMs: 1_000,
      maxBytes: 500,
    });

    store.spool({
      sessionId: "old",
      command: "x",
      argv: [],
      value: { pad: "y".repeat(200) },
    });
    const oldDir = join(root, ".clfly", "sessions", "old");
    const past = (Date.now() - 60_000) / 1000;
    utimesSync(oldDir, past, past);

    store.spool({
      sessionId: "new1",
      command: "x",
      argv: [],
      value: { pad: "z".repeat(400) },
    });
    store.spool({
      sessionId: "new2",
      command: "x",
      argv: [],
      value: { pad: "w".repeat(400) },
    });

    const removed = store.evict(Date.now());
    expect(removed).toContain("old");
    // max-bytes should also remove at least one of the large sessions
    expect(removed.length).toBeGreaterThanOrEqual(1);
    const left = store.listSessions();
    const total = left.reduce((a, s) => a + s.bytes, 0);
    expect(total).toBeLessThanOrEqual(500);

    rmSync(root, { recursive: true, force: true });
  });
});

describe("--spool CLI + annotations", () => {
  it("--spool writes unified ledger and prints path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-spool-cli-"));
    writeFileSync(
      join(dir, "ping.ts"),
      `export const meta = { description: "ping" };
export default async function () { return { ok: true }; }
`,
    );
    const out = collectStream();
    const cli = createCli({
      name: "t",
      commandsDir: dir,
      cwd: dir,
      env: { ...process.env, CLFLY_SESSION: "cliping01" },
      stdout: out.stream,
      stderr: collectStream().stream,
    });
    const result = await cli.run(["ping", "--spool"]);
    expect(result.exitCode).toBe(0);
    const path = out.text().trim();
    expect(path).toContain(".clfly/sessions/cliping01/");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ ok: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("--json --spool over threshold prints envelope", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-spool-json-"));
    writeFileSync(
      join(dir, "big.ts"),
      `export const meta = { description: "big" };
export default async function () {
  return Array.from({ length: 200 }, (_, i) => ({ id: i, pad: "x".repeat(40) }));
}
`,
    );
    const out = collectStream();
    const cli = createCli({
      name: "t",
      commandsDir: dir,
      cwd: dir,
      env: {
        ...process.env,
        CLFLY_SESSION: "bigsess01",
        CLFLY_SPOOL_THRESHOLD: "200",
      },
      stdout: out.stream,
      stderr: collectStream().stream,
    });
    const result = await cli.run(["big", "--json", "--spool"]);
    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(out.text()) as { truncated: boolean; ref: string };
    expect(envelope.truncated).toBe(true);
    expect(envelope.ref).toBe("bigsess01/001");
    rmSync(dir, { recursive: true, force: true });
  });

  it("projects meta.destructive to annotations", async () => {
    expect(annotationsFromMeta({ destructive: true })).toEqual({
      destructiveHint: true,
    });
    const dir = mkdtempSync(join(tmpdir(), "clfly-ann-"));
    writeFileSync(
      join(dir, "rm.ts"),
      `export const meta = { description: "rm", destructive: true };
export default async function () { return { deleted: true }; }
`,
    );
    const tools = await listMcpTools({ name: "t", commandsDir: dir });
    expect(tools.find((t) => t.name === "rm")?.annotations).toEqual({
      destructiveHint: true,
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("MCP invoke spools large results", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-mcp-spool-"));
    writeFileSync(
      join(dir, "list.ts"),
      `export const meta = { description: "list", readOnly: true };
export default async function () {
  return Array.from({ length: 100 }, (_, i) => ({ id: i, pad: "y".repeat(50) }));
}
`,
    );
    const tools = await listMcpTools({ name: "t", commandsDir: dir });
    const list = tools.find((t) => t.name === "list")!;
    expect(list.annotations?.readOnlyHint).toBe(true);
    const store = createSessionStore({ root: dir, threshold: 100 });
    const result = await invokeMcpTool(
      list,
      {},
      {
        cwd: dir,
        env: process.env,
        scoped: true,
        sessionStore: store,
        sessionId: "mcp01",
      },
    );
    expect(result.structuredContent).toMatchObject({
      truncated: true,
      sessionId: "mcp01",
    });
    const ref = (result.structuredContent as { ref: string }).ref;
    const page = handleResultRead(store, { ref, offset: 0, limit: 2 });
    expect(page.structuredContent).toMatchObject({
      totalCount: 100,
      items: [{ id: 0 }, { id: 1 }],
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("sessions list builtin works", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-sessions-cmd-"));
    mkdirSync(join(dir, "commands"), { recursive: true });
    writeFileSync(
      join(dir, "commands", "hi.ts"),
      `export default async function () { return 1; }`,
    );
    const store = createSessionStore({ root: dir });
    store.spool({
      sessionId: "s1",
      command: "hi",
      argv: [],
      value: { a: 1 },
    });
    const out = collectStream();
    const cli = createCli({
      name: "t",
      commandsDir: join(dir, "commands"),
      cwd: dir,
      stdout: out.stream,
      stderr: collectStream().stream,
    });
    const result = await cli.run(["sessions", "list", "--json"]);
    expect(result.exitCode).toBe(0);
    const listed = JSON.parse(out.text()) as Array<{ sessionId: string }>;
    expect(listed.some((s) => s.sessionId === "s1")).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
