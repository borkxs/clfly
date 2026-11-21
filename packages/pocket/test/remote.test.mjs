import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// The phone's side of `dash open X`: which pages count as remote, and which results name a URL to open.
const here = dirname(fileURLToPath(import.meta.url));
let m;
before(async () => {
  const outfile = join(mkdtempSync(join(tmpdir(), "pocket-remote-")), "remote.mjs");
  await build({ entryPoints: [join(here, "..", "src", "remote.ts")], bundle: true, format: "esm", outfile, logLevel: "silent" });
  m = await import(pathToFileURL(outfile).href);
});

test("a page on localhost is local; a tailnet or LAN name is remote", () => {
  for (const h of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"]) assert.equal(m.isRemoteHost(h), false, h);
  for (const h of ["mac.tail1234.ts.net", "192.168.1.14", "100.64.0.1"]) assert.equal(m.isRemoteHost(h), true, h);
});

test("only a result that says remote and carries an http(s) url is opened", () => {
  assert.equal(m.remoteUrl({ id: "film", url: "https://mac.tail1234.ts.net:8405/", remote: true }), "https://mac.tail1234.ts.net:8405/");
  assert.equal(m.remoteUrl({ id: "film", url: "http://localhost:5003/", started: false }), undefined);
  assert.equal(m.remoteUrl({ remote: true, url: "javascript:alert(1)" }), undefined);
  assert.equal(m.remoteUrl({ remote: true, url: "file:///etc/passwd" }), undefined);
  assert.equal(m.remoteUrl({ remote: true }), undefined);
  assert.equal(m.remoteUrl("https://x.test/"), undefined);
  assert.equal(m.remoteUrl(undefined), undefined);
});
