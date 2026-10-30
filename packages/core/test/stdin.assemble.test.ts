import { describe, expect, it } from "vitest";
import {
  assembleInput,
  decodeSingleJson,
  rewriteBindSentinels,
  resolveBindField,
  BIND_SENTINEL,
} from "../src/stdin/assemble.js";

describe("decodeSingleJson", () => {
  it("parses one object", () => {
    expect(decodeSingleJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("rejects NDJSON", () => {
    const r = decodeSingleJson('{"a":1}\n{"a":2}\n');
    expect(r.ok).toBe(false);
  });

  it("rejects invalid JSON", () => {
    const r = decodeSingleJson("not-json");
    expect(r.ok).toBe(false);
  });
});

describe("rewriteBindSentinels", () => {
  it("rewrites --flag -", () => {
    const r = rewriteBindSentinels(["--items", "-", "--status", "active"]);
    expect(r.argv).toEqual(["--items", BIND_SENTINEL, "--status", "active"]);
    expect(r.flagBindFields).toEqual(["items"]);
  });

  it("rewrites --flag=-", () => {
    const r = rewriteBindSentinels(["--items=-"]);
    expect(r.flagBindFields).toEqual(["items"]);
    expect(r.argv[0]).toBe(`--items=${BIND_SENTINEL}`);
  });

  it("removes --args - and counts it as a merge", () => {
    const r = rewriteBindSentinels(["--args", "-", "--status", "active"]);
    expect(r.argv).toEqual(["--status", "active"]);
    expect(r.flagBindFields).toEqual([]);
    expect(r.mergeCount).toBe(1);
    expect(rewriteBindSentinels(["--args=-"]).mergeCount).toBe(1);
  });

  it("counts two sentinels", () => {
    const r = rewriteBindSentinels(["--items", "-", "--extra", "-"]);
    expect(r.flagBindFields).toEqual(["items", "extra"]);
  });
});

describe("assembleInput", () => {
  const keys = new Set(["id", "limit", "magnet", "items", "status"]);

  it("ignores TTY stdin", () => {
    const r = assembleInput({
      argvArgs: {},
      stdinText: '{"id":"from-stdin"}',
      stdinIsTTY: true,
      declaredKeys: keys,
    });
    expect(r).toEqual({ ok: true, args: {} });
  });

  it("ignores non-TTY stdin without a sentinel", () => {
    const r = assembleInput({
      argvArgs: {},
      stdinText: '{"id":"from-stdin"}',
      stdinIsTTY: false,
      declaredKeys: keys,
    });
    expect(r).toEqual({ ok: true, args: {} });
  });

  it("merges non-TTY object and filters unknown keys", () => {
    const r = assembleInput({
      argvArgs: {},
      stdinText: '{"magnet":"abc","title":"x","seeders":12}',
      stdinIsTTY: false,
      declaredKeys: new Set(["magnet"]),
      merge: true,
    });
    expect(r).toEqual({ ok: true, args: { magnet: "abc" } });
  });

  it("lets argv win over stdin", () => {
    const r = assembleInput({
      argvArgs: { id: "from-argv" },
      stdinText: '{"id":"from-stdin","limit":10}',
      stdinIsTTY: false,
      declaredKeys: keys,
      merge: true,
    });
    expect(r).toEqual({
      ok: true,
      args: { id: "from-argv", limit: 10 },
    });
  });

  it("rejects array in merge mode", () => {
    const r = assembleInput({
      argvArgs: {},
      stdinText: "[]",
      stdinIsTTY: false,
      declaredKeys: keys,
      merge: true,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects empty stdin in merge mode", () => {
    const r = assembleInput({
      argvArgs: {},
      stdinText: "",
      stdinIsTTY: false,
      declaredKeys: keys,
      merge: true,
    });
    expect(r.ok).toBe(false);
  });

  it("binds entire JSON to field", () => {
    const r = assembleInput({
      argvArgs: { items: BIND_SENTINEL, status: "active" },
      stdinText: '[{"id":"u_1"}]',
      stdinIsTTY: false,
      declaredKeys: keys,
      bindField: "items",
    });
    expect(r).toEqual({
      ok: true,
      args: { items: [{ id: "u_1" }], status: "active" },
    });
  });

  it("bind disables merge of object stdin", () => {
    const r = assembleInput({
      argvArgs: { items: BIND_SENTINEL },
      stdinText: '{"items":[{"id":"x"}],"status":"from-stdin"}',
      stdinIsTTY: false,
      declaredKeys: keys,
      bindField: "items",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.args.items).toEqual({
        items: [{ id: "x" }],
        status: "from-stdin",
      });
      expect(r.args.status).toBeUndefined();
    }
  });
});

describe("resolveBindField", () => {
  it("errors on two flag binds", () => {
    const r = resolveBindField({}, ["items", "extra"], 0);
    expect(r.ok).toBe(false);
  });

  it("errors on --args - plus a field bind", () => {
    const r = resolveBindField({}, ["items"], 0, 1);
    expect(r.ok).toBe(false);
  });

  it("reports a lone --args - as merge", () => {
    expect(resolveBindField({}, [], 0, 1)).toEqual({ ok: true, merge: true });
  });
});
