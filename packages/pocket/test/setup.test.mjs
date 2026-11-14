import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ensureCoreDist, linkRaycastCore } from "../../../scripts/setup.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function fakeRoot() {
  const root = mkdtempSync(join(tmpdir(), "clfly-setup-"));
  mkdirSync(join(root, "packages", "core"), { recursive: true });
  mkdirSync(join(root, "packages", "raycast"), { recursive: true });
  return root;
}
const linkOf = (root) => join(root, "packages", "raycast", "node_modules", "@clfly", "core");

test("this checkout's raycast resolves @clfly/core to packages/core (the root postinstall linked it)", () => {
  assert.equal(realpathSync(linkOf(repo)), realpathSync(join(repo, "packages", "core")));
});

test("a fresh checkout gets a relative link, and a second run keeps it", () => {
  const root = fakeRoot();
  assert.equal(linkRaycastCore(root), "linked");
  assert.equal(readlinkSync(linkOf(root)), join("..", "..", "..", "core"));
  assert.equal(realpathSync(linkOf(root)), realpathSync(join(root, "packages", "core")));
  assert.equal(linkRaycastCore(root), "kept");
});

test("a link pointing elsewhere is replaced", () => {
  const root = fakeRoot();
  mkdirSync(dirname(linkOf(root)), { recursive: true });
  symlinkSync(tmpdir(), linkOf(root), "dir");
  assert.equal(linkRaycastCore(root), "linked");
  assert.equal(realpathSync(linkOf(root)), realpathSync(join(root, "packages", "core")));
});

test("core is built only when its dist is missing", () => {
  const root = fakeRoot();
  const calls = [];
  const run = (cmd, args) => (calls.push([cmd, ...args]), 0);
  assert.equal(ensureCoreDist(root, run), "built");
  assert.deepEqual(calls, [["pnpm", "--filter", "@clfly/core", "build"]]);
  mkdirSync(join(root, "packages", "core", "dist"));
  writeFileSync(join(root, "packages", "core", "dist", "index.js"), "");
  assert.equal(ensureCoreDist(root, run), "kept");
  assert.equal(calls.length, 1);
  assert.throws(() => ensureCoreDist(fakeRoot(), () => 1), /build failed/);
  assert.ok(!existsSync(join(fakeRoot(), "packages", "core", "dist")));
});
