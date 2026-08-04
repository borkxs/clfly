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

  it("merges non-TTY object and filters unknown keys", () => {
    const r = assembleInput({
      argvArgs: {},
      stdinText: '{"magnet":"abc","title":"x","seeders":12}',
      stdinIsTTY: false,
      declaredKeys: new Set(["magnet"]),
    });
    expect(r).toEqual({ ok: true, args: { magnet: "abc" } });
  });

  it("lets argv win over stdin", () => {
    const r = assembleInput({
      argvArgs: { id: "from-argv" },
      stdinText: '{"id":"from-stdin","limit":10}',
      stdinIsTTY: false,
      declaredKeys: keys,
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
});
