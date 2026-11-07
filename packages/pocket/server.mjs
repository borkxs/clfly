// The engine behind the line editor: serves the page, hands out the manifest, runs
// commands by argv (never a shell), and keeps the list of runs. Zero dependencies
// beyond node and the clfly on PATH. Binds to localhost unless POCKET_HOST says otherwise.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.POCKET_PORT || 4180);
const HOST = process.env.POCKET_HOST || "127.0.0.1";
const CLFLY = process.env.CLFLY_BIN || "clfly";
// Short: the page asks again each time the panel opens, so a merged tree change shows up quickly.
const MANIFEST_TTL = 15_000;
const LOG = join(homedir(), ".local", "state", "clfly", "pocket-runs.jsonl");

// --- running things ----------------------------------------------------------

/** A launcher started from a hotkey has no shell profile; pick up the usual bins. */
function searchPath() {
  const home = homedir();
  const nvm = join(home, ".nvm", "versions", "node");
  const nvmBins = existsSync(nvm)
    ? readdirSync(nvm)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .map((v) => join(nvm, v, "bin"))
    : [];
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    ...nvmBins,
    join(home, "Library", "pnpm"),
    join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].filter(Boolean);
  return [...new Set(dirs)].join(delimiter);
}

/** Run an executable with an argv array. `.js`/`.mjs` bins go through node. */
function execArgv(bin, argv, { timeoutMs = 10 * 60_000 } = {}) {
  const viaNode = /\.(c|m)?js$/.test(bin);
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      viaNode ? "node" : bin,
      viaNode ? [bin, ...argv] : argv,
      {
        cwd: homedir(),
        env: { ...process.env, PATH: searchPath(), NO_COLOR: "1", FORCE_COLOR: "0" },
        maxBuffer: 64 * 1024 * 1024,
        timeout: timeoutMs,
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
        const out = { code, stdout, stderr, ms: Date.now() - started };
        const text = stdout.trim();
        if (text) {
          try {
            out.json = JSON.parse(text);
          } catch {
            /* text output */
          }
        }
        if (code !== 0) out.error = errorMessage(stderr) ?? err?.message ?? `exited ${code}`;
        resolve(out);
      },
    );
  });
}

function errorMessage(stderr) {
  const start = stderr.indexOf("{");
  if (start >= 0) {
    try {
      const body = JSON.parse(stderr.slice(start));
      if (body?.error?.message) return body.error.message;
    } catch {
      /* fall through */
    }
  }
  return stderr.trim().split("\n").filter(Boolean).pop();
}

// --- manifest ----------------------------------------------------------------

let manifest = { trees: [], at: 0, error: undefined };

async function loadManifest(force = false) {
  if (!force && Date.now() - manifest.at < MANIFEST_TTL) return manifest;
  const res = await execArgv(CLFLY, ["manifest", "--json"], { timeoutMs: 60_000 });
  if (res.code !== 0 || !res.json?.trees) {
    manifest = { ...manifest, at: Date.now(), error: res.error ?? "clfly manifest returned no JSON" };
  } else {
    manifest = { trees: res.json.trees, at: Date.now(), error: undefined };
  }
  return manifest;
}

const DESTRUCTIVE = new Set(["rm", "remove", "delete", "apply", "reset", "down", "uninstall", "unlink", "clean"]);

/** The route `argv` addresses in `tree`: static words must match, `:params` take any word. */
function routeFor(tree, argv) {
  const words = argv.filter((w) => !w.startsWith("-"));
  let best;
  for (const r of tree.routes) {
    if (r.path.length > words.length) continue;
    if (!r.path.every((s, i) => s.startsWith(":") || s === words[i])) continue;
    if (!best || r.path.length > best.path.length) best = r;
  }
  return best;
}

function isDestructive(route) {
  if (!route) return false;
  if (route.meta?.destructive) return true;
  if (route.meta?.readOnly) return false;
  const last = [...route.path].reverse().find((s) => !s.startsWith(":"));
  return last !== undefined && DESTRUCTIVE.has(last);
}

// --- runs --------------------------------------------------------------------

/** Recent runs, newest first. Output stays in memory; the line goes to the log. */
const runs = [];
const MAX_RUNS = 50;

function summary(run) {
  const { stdout, stderr, json, ...rest } = run;
  return { ...rest, hasJson: json !== undefined, hasText: Boolean(stdout?.trim() || stderr?.trim()) };
}

async function startRun({ tree, argv, line }) {
  const run = {
    id: randomUUID().slice(0, 8),
    tree: tree.name,
    argv,
    line: line ?? [tree.name, ...argv].join(" "),
    status: "running",
    startedAt: new Date().toISOString(),
  };
  runs.unshift(run);
  if (runs.length > MAX_RUNS) runs.length = MAX_RUNS;
  execArgv(tree.bin, argv).then((res) => {
    Object.assign(run, res, { status: res.code === 0 ? "done" : "failed", endedAt: new Date().toISOString() });
    log({ ...summary(run), code: res.code, ms: res.ms }).catch(() => {});
  });
  return run;
}

async function log(entry) {
  await mkdir(dirname(LOG), { recursive: true });
  await appendFile(LOG, `${JSON.stringify(entry)}\n`);
}

/** Every line that ran, from the log: how often and when last, newest first. Shared by all faces. */
async function history() {
  let text = "";
  try {
    text = await readFile(LOG, "utf8");
  } catch {
    return [];
  }
  const byLine = new Map();
  for (const raw of text.split("\n")) {
    if (!raw) continue;
    let e;
    try {
      e = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof e.line !== "string" || !e.line.trim()) continue;
    const line = e.line.trim();
    const t = Date.parse(e.endedAt ?? e.startedAt ?? "") || 0;
    const h = byLine.get(line) ?? { line, n: 0, t: 0 };
    h.n += 1;
    h.t = Math.max(h.t, t);
    h.ok = e.status === "done";
    byLine.set(line, h);
  }
  return [...byLine.values()].sort((a, b) => b.t - a.t);
}

// --- http --------------------------------------------------------------------

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/app.js.map": ["app.js.map", "application/json"],
  "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
};

function send(res, status, body, type = "application/json") {
  const data = type.startsWith("application/json") ? JSON.stringify(body) : body;
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(data);
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function badArgv(argv) {
  return !Array.isArray(argv) || argv.some((w) => typeof w !== "string");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (req.method === "GET" && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      try {
        return send(res, 200, await readFile(join(here, "public", file)), type);
      } catch {
        return send(res, 404, { error: `${file} not built; run pnpm build` });
      }
    }
    if (req.method === "GET" && url.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "GET" && url.pathname === "/api/manifest") {
      const m = await loadManifest(url.searchParams.has("refresh"));
      return send(res, m.error && !m.trees.length ? 502 : 200, { trees: m.trees, at: m.at, error: m.error });
    }
    if (req.method === "GET" && url.pathname === "/api/history") {
      return send(res, 200, { history: await history() });
    }
    if (req.method === "GET" && url.pathname === "/api/runs") {
      return send(res, 200, { runs: runs.map(summary) });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/runs/")) {
      const run = runs.find((r) => r.id === url.pathname.slice("/api/runs/".length));
      return run ? send(res, 200, run) : send(res, 404, { error: "no such run" });
    }
    if (req.method === "POST" && (url.pathname === "/api/run" || url.pathname === "/api/exec")) {
      const b = await body(req);
      const m = await loadManifest();
      const tree = m.trees.find((t) => t.name === b.tree);
      if (!tree) return send(res, 400, { error: `no tree named ${b.tree}` });
      if (badArgv(b.argv)) return send(res, 400, { error: "argv must be a list of strings" });
      const route = routeFor(tree, b.argv);
      if (url.pathname === "/api/exec") {
        // Waited on: choice sources and live searches. Never anything destructive.
        if (isDestructive(route)) return send(res, 403, { error: "exec is for read-only commands" });
        return send(res, 200, await execArgv(tree.bin, b.argv, { timeoutMs: 120_000 }));
      }
      if (isDestructive(route) && b.confirmed !== true) {
        return send(res, 409, { error: "destructive command needs confirmed: true", destructive: true });
      }
      return send(res, 202, summary(await startRun({ tree, argv: b.argv, line: b.line })));
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`clfly pocket on http://${HOST}:${PORT}`);
  loadManifest().then((m) => console.log(m.error ? `manifest: ${m.error}` : `manifest: ${m.trees.length} trees`));
});
