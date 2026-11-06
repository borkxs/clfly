import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { writeAtomic } from "../registry/io.js";
import { runLs } from "../registry/link.js";
import { userHome } from "../registry/paths.js";

/**
 * `clfly changelog`: one dated list of capability changes on this machine, derived from
 * what is on disk. Three kinds of source:
 * - skills, dated by the dir's birth time (mtime when the filesystem has none);
 * - repo-root CHANGELOG.md lines of every repo that hosts a linked tree, dated by heading;
 * - a snapshot of trees, command files, MCP servers, hooks, tick jobs and dash cards,
 *   diffed against the previous snapshot; each difference becomes an event dated to the
 *   snapshot that first saw it (hourly when the tick job runs it).
 */

export type Kind = "skill" | "command" | "tree" | "mcp" | "hook" | "tick" | "dash";
export const SNAPSHOT_KINDS = ["tree", "command", "mcp", "hook", "tick", "dash"] as const;
export type SnapshotKind = (typeof SNAPSHOT_KINDS)[number];

export interface Entry {
  /** ISO timestamp, or a bare YYYY-MM-DD for CHANGELOG lines. */
  at: string;
  kind: Kind;
  name: string;
  change: "added" | "removed";
  source: string;
}

/** name → one-line detail, per kind. */
export type State = Record<SnapshotKind, Record<string, string>>;
export interface Snapshot {
  takenAt: string;
  state: State;
}

export type RunJson = (command: string, args: string[]) => unknown | undefined;

export function stateDir(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_STATE_HOME?.trim();
  return join(xdg || join(userHome(env), ".local", "state"), "clfly");
}

function oneLine(text: string, max = 110): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function readJson(file: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Run a sibling CLI with `--json`; undefined when it is missing or fails. */
export const spawnJson: RunJson = (command, args) => {
  const res = spawnSync(command, args, { encoding: "utf8", timeout: 20_000 });
  if (res.status !== 0 || !res.stdout) return undefined;
  try {
    return JSON.parse(res.stdout);
  } catch {
    return undefined;
  }
};

// ---------- skills ----------

export function collectSkills(dirs: string[], home: string): Entry[] {
  const byName = new Map<string, { at: number; where: string[] }>();
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const path = join(dir, name);
      // A skill is a dir (or a link to one) holding SKILL.md; other dirs (claude.ai sync caches) are not.
      if (!existsSync(join(path, "SKILL.md"))) continue;
      const st = lstatSync(path);
      const born = st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs;
      const where = `${st.isSymbolicLink() ? "linked into" : "new dir in"} ${dir.replace(home, "~")}`;
      const prev = byName.get(name);
      if (prev) {
        prev.at = Math.min(prev.at, born);
        prev.where.push(where);
      } else byName.set(name, { at: born, where: [where] });
    }
  }
  return [...byName].map(([name, v]) => ({
    at: new Date(v.at).toISOString(),
    kind: "skill" as const,
    name,
    change: "added" as const,
    source: v.where.join(", "),
  }));
}

// ---------- CHANGELOG.md ----------

/** `## YYYY-MM-DD` headings and `- \`tree command\` — text` bullets. */
export function parseChangelog(text: string): Entry[] {
  const out: Entry[] = [];
  let date: string | null = null;
  for (const line of text.split("\n")) {
    const heading = /^##\s+(\d{4}-\d{2}-\d{2})\b/.exec(line);
    if (heading) {
      date = heading[1]!;
      continue;
    }
    if (!date) continue;
    // one or more leading command names: "- `a`, `b` — text"
    const bullet = /^- ((?:`[^`]+`\s*,\s*)*`[^`]+`)\s*(.*)$/.exec(line);
    if (!bullet) continue;
    const names = [...bullet[1]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    const rest = bullet[2]!.replace(/^[—–-]+\s*/, "").replace(/\s*\(\[#\d+\]\([^)]*\)\)\s*$/, "");
    const pr = /\[#(\d+)\]/.exec(bullet[2]!);
    out.push({
      at: date,
      kind: "command",
      name: names.join(", "),
      change: /\b(removed|retired)\b/i.test(rest.slice(0, 30)) ? "removed" : "added",
      source: oneLine(pr ? `#${pr[1]} ${rest}` : rest),
    });
  }
  return out;
}

function gitRoot(path: string): string | null {
  let cur = path;
  while (true) {
    if (existsSync(join(cur, ".git"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

export function collectChangelogs(treePaths: string[]): Entry[] {
  const roots = new Set<string>();
  for (const p of treePaths) {
    const root = gitRoot(p);
    if (root) roots.add(root);
  }
  const out: Entry[] = [];
  for (const root of roots) {
    const file = join(root, "CHANGELOG.md");
    if (!existsSync(file)) continue;
    out.push(...parseChangelog(readFileSync(file, "utf8")));
  }
  return out;
}

// ---------- snapshot ----------

/** Command paths from a tree's `commands/` (or `src/commands/`) files. */
export function commandFiles(treePath: string): string[] {
  const dir = [join(treePath, "commands"), join(treePath, "src", "commands")].find((d) => existsSync(d));
  if (!dir) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith("_") || name.startsWith(".") || name === "node_modules") continue;
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(m?ts|m?js)$/.test(name) && !/\.(test|spec|d)\.[mc]?[tj]s$/.test(name)) {
        const segs = relative(dir, path)
          .replace(/\.[mc]?[tj]s$/, "")
          .split(/[\\/]/)
          .map((s) => s.replace(/^\[(.+)\]$/, ":$1"));
        if (segs[segs.length - 1] === "index") segs.pop();
        if (segs.length) out.push(segs.join(" "));
      }
    }
  };
  walk(dir);
  return out.sort();
}

export function collectState(input: { env: NodeJS.ProcessEnv; runJson: RunJson }): {
  state: State;
  treePaths: string[];
  missing: SnapshotKind[];
} {
  const home = userHome(input.env);
  const state: State = { tree: {}, command: {}, mcp: {}, hook: {}, tick: {}, dash: {} };
  const missing: SnapshotKind[] = [];

  const { rows } = runLs({ env: input.env, prune: false, whichFn: () => null });
  const treePaths: string[] = [];
  for (const row of rows) {
    state.tree[row.name] = row.path.replace(home, "~");
    if (row.stale) continue;
    treePaths.push(row.path);
    for (const cmd of commandFiles(row.path)) state.command[`${row.name} ${cmd}`] = "new command file";
  }

  const claudeJson = readJson(join(home, ".claude.json")) as { mcpServers?: Record<string, unknown> } | undefined;
  if (claudeJson) {
    for (const [name, cfg] of Object.entries(claudeJson.mcpServers ?? {})) {
      const c = cfg as { command?: string; args?: string[]; url?: string };
      state.mcp[name] = oneLine(c.url ?? [c.command, ...(c.args ?? [])].filter(Boolean).join(" ").replace(home, "~"));
    }
  } else missing.push("mcp");

  const settings = readJson(join(home, ".claude", "settings.json")) as
    | { hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>> }
    | undefined;
  if (settings) {
    for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
      for (const group of groups ?? []) {
        for (const hook of group.hooks ?? []) {
          if (!hook.command) continue;
          const name = `${event}${group.matcher ? `[${group.matcher}]` : ""}: ${hook.command.replace(home, "~")}`;
          state.hook[oneLine(name, 140)] = event;
        }
      }
    }
  } else missing.push("hook");

  const tick = input.runJson("tick", ["ls", "--json"]) as { jobs?: Array<{ name: string; command: string; schedule: string }> } | undefined;
  if (tick?.jobs) for (const j of tick.jobs) state.tick[j.name] = oneLine(`${j.schedule}: ${j.command}`);
  else missing.push("tick");

  const dash = input.runJson("dash", ["ls", "--json"]) as { dashboards?: Array<{ id: string; name?: string; area?: string }> } | undefined;
  if (dash?.dashboards) for (const d of dash.dashboards) state.dash[d.id] = oneLine([d.name, d.area].filter(Boolean).join(", "));
  else missing.push("dash");

  return { state, treePaths, missing };
}

/** Differences between two states as events dated `at`. Kinds in `skip` (unreadable this run) are left alone. */
export function diffStates(prev: State, cur: State, at: string, skip: SnapshotKind[] = []): Entry[] {
  const out: Entry[] = [];
  for (const kind of SNAPSHOT_KINDS) {
    if (skip.includes(kind)) continue;
    const a = prev[kind] ?? {};
    const b = cur[kind] ?? {};
    for (const name of Object.keys(b)) if (!(name in a)) out.push({ at, kind, name, change: "added", source: b[name]! });
    for (const name of Object.keys(a)) if (!(name in b)) out.push({ at, kind, name, change: "removed", source: a[name]! });
  }
  return out;
}

export function readEvents(file: string): Entry[] {
  if (!existsSync(file)) return [];
  const out: Entry[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Entry);
    } catch {
      // a torn line from an interrupted write; skip it
    }
  }
  return out;
}

/**
 * Take a snapshot: diff against the previous one, append the differences to the event log,
 * write the new snapshot. The first run only writes the baseline (no events).
 */
export function takeSnapshot(input: { env: NodeJS.ProcessEnv; runJson: RunJson; now: Date }): {
  added: Entry[];
  baseline: boolean;
  treePaths: string[];
  missing: SnapshotKind[];
} {
  const dir = stateDir(input.env);
  const snapFile = join(dir, "changelog-snapshot.json");
  const eventsFile = join(dir, "changelog-events.jsonl");
  const { state, treePaths, missing } = collectState(input);
  const prev = readJson(snapFile) as Snapshot | undefined;
  const at = input.now.toISOString();
  // An unreadable source keeps its previous contents so a flaky `tick ls` doesn't log removals.
  for (const kind of missing) if (prev?.state?.[kind]) state[kind] = prev.state[kind];
  const added = prev?.state ? diffStates(prev.state, state, at, missing) : [];
  mkdirSync(dir, { recursive: true });
  if (added.length) appendFileSync(eventsFile, added.map((e) => JSON.stringify(e)).join("\n") + "\n");
  writeAtomic(snapFile, JSON.stringify({ takenAt: at, state } satisfies Snapshot, null, 2) + "\n");
  return { added, baseline: !prev?.state, treePaths, missing };
}

// ---------- assembling ----------

/** `7d`, `12h`, `2w`, or a date; returns the cutoff as epoch ms. */
export function parseSince(since: string, now: Date): number {
  const rel = /^(\d+)([hdw])$/.exec(since.trim());
  if (rel) {
    const unit = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[rel[2] as "h" | "d" | "w"];
    return now.getTime() - Number(rel[1]) * unit;
  }
  const abs = Date.parse(since);
  if (Number.isNaN(abs)) throw new Error(`--since: expected 7d, 12h, 2w or a date, got "${since}"`);
  return abs;
}

/** Bare dates sort as the end of that day so a CHANGELOG line sits above that day's snapshot events. */
function sortKey(at: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(at) ? Date.parse(`${at}T23:59:59`) : Date.parse(at);
}

export function assemble(input: { skills: Entry[]; changelog: Entry[]; events: Entry[]; cutoff: number }): Entry[] {
  const named = new Set(input.changelog.map((e) => e.name));
  // A command file whose command already has a CHANGELOG line says nothing new.
  const events = input.events.filter((e) => !(e.kind === "command" && e.change === "added" && named.has(e.name)));
  return [...input.skills, ...input.changelog, ...events]
    .filter((e) => sortKey(e.at) >= input.cutoff)
    .sort((a, b) => sortKey(b.at) - sortKey(a.at));
}

function localStamp(at: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return `${at}      `;
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatEntries(entries: Entry[]): string {
  if (!entries.length) return "No capability changes in this window.\n";
  return (
    entries
      .map((e) => {
        const kind = e.change === "removed" ? `-${e.kind}` : e.kind;
        return `${localStamp(e.at)}  ${kind.padEnd(8)} ${e.name}  ${e.source}`;
      })
      .join("\n") + "\n"
  );
}

export function runChangelog(input: {
  env: NodeJS.ProcessEnv;
  since: string;
  now?: Date;
  runJson?: RunJson;
}): { entries: Entry[]; baseline: boolean; missing: SnapshotKind[]; newEvents: number } {
  const now = input.now ?? new Date();
  const cutoff = parseSince(input.since, now);
  const home = userHome(input.env);
  const snap = takeSnapshot({ env: input.env, runJson: input.runJson ?? spawnJson, now });
  const skills = collectSkills(
    [join(home, ".claude", "skills"), join(home, "git", "_agent-shared", "skills")],
    home,
  );
  const changelog = collectChangelogs(snap.treePaths);
  const events = readEvents(join(stateDir(input.env), "changelog-events.jsonl"));
  return {
    entries: assemble({ skills, changelog, events, cutoff }),
    baseline: snap.baseline,
    missing: snap.missing,
    newEvents: snap.added.length,
  };
}
