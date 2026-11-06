import { lutimesSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assemble,
  commandFiles,
  diffStates,
  formatEntries,
  parseChangelog,
  parseSince,
  runChangelog,
  takeSnapshot,
  type RunJson,
  type State,
} from "../src/changelog/changelog.js";

const empty = (): State => ({ tree: {}, command: {}, mcp: {}, hook: {}, tick: {}, dash: {} });

describe("parseChangelog", () => {
  it("dates bullets by the heading above them and strips the PR link", () => {
    const entries = parseChangelog(
      [
        "# Changelog",
        "- `ignored` — before any date",
        "## 2026-11-06",
        "- `loop add` — queue an item ([#192](https://github.com/borkxs/borkxs-mono/pull/192))",
        "## 2026-11-05",
        "- `pm get` — removed; use pm add",
        "- `dash wait`, `dash done` — manual steps",
        "not a bullet",
      ].join("\n"),
    );
    expect(entries).toEqual([
      { at: "2026-11-06", kind: "command", name: "loop add", change: "added", source: "#192 queue an item" },
      { at: "2026-11-05", kind: "command", name: "pm get", change: "removed", source: "removed; use pm add" },
      { at: "2026-11-05", kind: "command", name: "dash wait, dash done", change: "added", source: "manual steps" },
    ]);
  });
});

describe("diffStates", () => {
  it("reports additions and removals and leaves skipped kinds alone", () => {
    const prev = empty();
    prev.tick = { old: "every 1h: old" };
    prev.dash = { gone: "x" };
    const cur = empty();
    cur.tick = { fresh: "every 1h: fresh" };
    cur.mcp = { loop: "loop mcp serve" };
    const out = diffStates(prev, cur, "2026-11-06T10:00:00.000Z", ["dash"]);
    expect(out.map((e) => `${e.change} ${e.kind} ${e.name}`).sort()).toEqual([
      "added mcp loop",
      "added tick fresh",
      "removed tick old",
    ]);
  });
});

describe("parseSince", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  it("reads relative windows and dates", () => {
    expect(parseSince("1d", now)).toBe(Date.parse("2026-11-05T12:00:00Z"));
    expect(parseSince("2026-11-01", now)).toBe(Date.parse("2026-11-01"));
    expect(() => parseSince("soon", now)).toThrow(/--since/);
  });
});

describe("assemble", () => {
  it("sorts newest first, filters by cutoff, and drops command files a CHANGELOG line covers", () => {
    const out = assemble({
      skills: [{ at: "2026-11-05T18:46:00.000Z", kind: "skill", name: "phone-resume", change: "added", source: "new dir" }],
      changelog: [{ at: "2026-11-06", kind: "command", name: "loop add", change: "added", source: "#192 queue" }],
      events: [
        { at: "2026-11-06T09:00:00.000Z", kind: "command", name: "loop add", change: "added", source: "new command file" },
        { at: "2026-11-06T09:00:00.000Z", kind: "tree", name: "loop", change: "added", source: "~/git/x" },
        { at: "2026-10-01T09:00:00.000Z", kind: "tick", name: "ancient", change: "added", source: "old" },
      ],
      cutoff: Date.parse("2026-11-01"),
    });
    expect(out.map((e) => `${e.kind} ${e.name}`)).toEqual(["command loop add", "tree loop", "skill phone-resume"]);
    expect(formatEntries(out)).toContain("command  loop add  #192 queue");
  });
});

describe("commandFiles", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clfly-cmds-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("turns command files into command paths", () => {
    const c = join(dir, "src", "commands");
    mkdirSync(join(c, "queue", "[id]"), { recursive: true });
    mkdirSync(join(c, "_lib"), { recursive: true });
    writeFileSync(join(c, "ready.ts"), "");
    writeFileSync(join(c, "queue", "index.ts"), "");
    writeFileSync(join(c, "queue", "[id]", "show.ts"), "");
    writeFileSync(join(c, "queue", "x.test.ts"), "");
    writeFileSync(join(c, "_lib", "util.ts"), "");
    expect(commandFiles(dir)).toEqual(["queue", "queue :id show", "ready"]);
  });
});

describe("runChangelog (fixture home)", () => {
  let home: string;
  let env: NodeJS.ProcessEnv;
  let tickJobs: Array<{ name: string; command: string; schedule: string }>;
  const runJson: RunJson = (command) =>
    command === "tick" ? { jobs: tickJobs } : command === "dash" ? { dashboards: [{ id: "songs", name: "Song tracker" }] } : undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "clfly-changelog-"));
    env = { HOME: home };
    tickJobs = [{ name: "usage-sync", command: "usage sync", schedule: "every 15m" }];
    // a repo with one linked tree and a root CHANGELOG
    const repo = join(home, "git", "mono");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "packages", "loop", "commands"), { recursive: true });
    writeFileSync(join(repo, "packages", "loop", "commands", "ready.ts"), "");
    writeFileSync(join(repo, "CHANGELOG.md"), "# Changelog\n\n## 2026-11-06\n\n- `loop ready` — lists ready items\n");
    mkdirSync(join(home, ".config", "clfly"), { recursive: true });
    writeFileSync(
      join(home, ".config", "clfly", "registry.json"),
      JSON.stringify({
        formatVersion: 1,
        trees: {
          loop: { name: "loop", path: join(repo, "packages", "loop"), bin: "loop", coreVersion: "0.3.0", manifest: null, root: repo, linkedAt: "x", registered: {} },
        },
      }),
    );
    // skills: a source dir and a link to it
    const shared = join(home, "git", "_agent-shared", "skills", "phone-resume");
    mkdirSync(shared, { recursive: true });
    writeFileSync(join(shared, "SKILL.md"), "---\nname: phone-resume\n---\n");
    mkdirSync(join(home, ".claude", "skills", "synced", "cache"), { recursive: true });
    symlinkSync(shared, join(home, ".claude", "skills", "phone-resume"));
    // birth time is now; an older mtime stands in for "made yesterday"
    const made = new Date("2026-11-05T18:46:00Z");
    utimesSync(shared, made, made);
    lutimesSync(join(home, ".claude", "skills", "phone-resume"), made, made);
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { loop: { command: "loop", args: ["mcp", "serve"] } } }));
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "usage nudge hook" }] }] } }),
    );
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("first run writes a baseline; a later run dates the differences to that snapshot", () => {
    const first = runChangelog({ env, since: "30d", now: new Date("2026-11-06T10:00:00Z"), runJson });
    expect(first.baseline).toBe(true);
    expect(first.entries.map((e) => `${e.kind} ${e.name}`)).toEqual(["command loop ready", "skill phone-resume"]);
    expect(first.entries[1]).toMatchObject({
      at: "2026-11-05T18:46:00.000Z",
      source: "linked into ~/.claude/skills, new dir in ~/git/_agent-shared/skills",
    });

    tickJobs.push({ name: "clfly-changelog", command: "clfly changelog --snapshot", schedule: "every 1h" });
    const snap = takeSnapshot({ env, runJson, now: new Date("2026-11-06T11:00:00Z") });
    expect(snap.baseline).toBe(false);
    expect(snap.added).toEqual([
      { at: "2026-11-06T11:00:00.000Z", kind: "tick", name: "clfly-changelog", change: "added", source: "every 1h: clfly changelog --snapshot" },
    ]);

    // a failing `tick ls` must not log every job as removed
    const flaky: RunJson = (c, a) => (c === "tick" ? undefined : runJson(c, a));
    const quiet = takeSnapshot({ env, runJson: flaky, now: new Date("2026-11-06T12:00:00Z") });
    expect(quiet.added).toEqual([]);
    expect(quiet.missing).toEqual(["tick"]);
    const snapFile = JSON.parse(readFileSync(join(home, ".local", "state", "clfly", "changelog-snapshot.json"), "utf8"));
    expect(Object.keys(snapFile.state.tick)).toContain("clfly-changelog");

    const later = runChangelog({ env, since: "30d", now: new Date("2026-11-06T13:00:00Z"), runJson });
    expect(later.entries.map((e) => `${e.kind} ${e.name}`)).toEqual([
      "command loop ready",
      "tick clfly-changelog",
      "skill phone-resume",
    ]);
  });
});
