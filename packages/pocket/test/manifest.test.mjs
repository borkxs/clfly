import assert from "node:assert/strict";
import { test } from "node:test";
import { manifestCache, manifestFailure } from "../manifest.mjs";

const TREES = [{ name: "pm", bin: "/bin/pm", routes: [{ path: ["links", ":id"] }] }];
const ok = { code: 0, json: { trees: TREES } };
// What a clfly build without the command prints (G39: a stale clfly linked on PATH).
const noManifest = { code: 1, error: "Run with --help to see available commands.", stderr: "Unknown command: manifest\nRun with --help to see available commands.\n" };

function seq(...results) {
  let i = 0;
  return async () => results[Math.min(i++, results.length - 1)];
}

test("a clfly without manifest, before any good load, is an error that says what to do", async () => {
  const load = manifestCache(seq(noManifest), { bin: "clfly" });
  const m = await load();
  assert.deepEqual(m.trees, []);
  assert.match(m.error, /clfly has no "manifest" command/);
  assert.match(m.error, /CLFLY_BIN/);
  assert.equal(m.stale, undefined);
});

test("a failed refresh after a good load keeps the trees and reports stale, not error", async () => {
  let t = 0;
  const load = manifestCache(seq(ok, noManifest), { ttlMs: 10, now: () => t });
  assert.deepEqual((await load()).trees, TREES);
  t = 100;
  const m = await load();
  assert.deepEqual(m.trees, TREES);
  assert.equal(m.error, undefined);
  assert.match(m.stale, /no "manifest" command/);
});

test("a good refresh clears stale", async () => {
  const load = manifestCache(seq(ok, noManifest, ok));
  await load();
  assert.ok((await load(true)).stale);
  const m = await load(true);
  assert.equal(m.stale, undefined);
  assert.equal(m.error, undefined);
});

test("within the ttl the cache does not run clfly again", async () => {
  let calls = 0;
  const load = manifestCache(async () => (calls++, ok), { ttlMs: 1000, now: () => 5 });
  await load();
  await load();
  assert.equal(calls, 1);
});

test("other failures pass their message through", () => {
  assert.equal(manifestFailure("clfly", { code: 1, error: "spawn clfly ENOENT" }), "spawn clfly ENOENT");
  assert.equal(manifestFailure("clfly", { code: 0 }), "clfly manifest returned no JSON");
});
