import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildArgv,
  chainsFor,
  childrenAt,
  commandLine,
  isDestructive,
  isLiveSearch,
  missingParams,
  paramCompleteFrom,
  parseTyped,
  runsBare,
  tokenize,
  rowAccessories,
  rowTitle,
  shapeOutput,
  sourceRunnable,
  type Route,
  type Tree,
} from "../src/lib/model";
import { normalizeReleaseTitle, suggestCompletions } from "../src/lib/release";

const search: Route = {
  path: ["search"],
  meta: { readOnly: true },
  positionals: [{ name: "query", source: "export", optional: false, alsoFlag: true }],
  flags: [
    { name: "res", type: "string", optional: true, enum: ["720p", "1080p"] },
    { name: "limit", type: "number", optional: true },
    { name: "copy-only", type: "boolean", optional: true },
  ],
};
const add: Route = {
  path: ["add"],
  positionals: [
    {
      name: "magnet",
      source: "export",
      optional: false,
      completeFrom: { cmd: "pm search", args: { query: "$query" }, field: "hits[].infoHash", label: "title" },
    },
  ],
  flags: [{ name: "watch", type: "boolean", optional: true }],
};
const pm: Tree = { name: "pm", bin: "/x/pm.mjs", root: "/x", routes: [search, add, { path: ["prune"], flags: [], positionals: [] }, { path: ["prune", "apply"], flags: [], positionals: [] }] };

const jobRm: Route = {
  path: ["job", ":job", "rm"],
  positionals: [{ name: "job", source: "path", optional: false, completeFrom: { cmd: "run ls", field: "jobs[].name" } }],
  flags: [{ name: "keep", type: "boolean", optional: true, default: true }, { name: "tag", type: "array", optional: true }],
};
const run: Tree = {
  name: "run",
  bin: "/r/run.mjs",
  root: "/r",
  routes: [{ path: ["ls"], meta: { readOnly: true }, flags: [], positionals: [] }, jobRm, { path: ["job", ":job"], flags: [], positionals: [] }, { path: ["reset"], flags: [], positionals: [] }],
};

describe("drill-down", () => {
  it("lists statics before dynamics with leaf/children info", () => {
    expect(childrenAt(pm, []).map((c) => [c.segment, !!c.leaf, c.hasChildren])).toEqual([
      ["add", true, false],
      ["prune", true, true],
      ["search", true, false],
    ]);
    expect(childrenAt(run, ["job"]).map((c) => [c.segment, !!c.leaf, c.hasChildren, c.count])).toEqual([[":job", true, true, 2]]);
    expect(paramCompleteFrom(run, ["job"], "job")?.cmd).toBe("run ls");
    expect(missingParams(jobRm, {})).toEqual(["job"]);
    expect(missingParams(jobRm, { job: "a" })).toEqual([]);
  });
});

describe("buildArgv", () => {
  it("orders path, positionals, flags, --json and skips empties", () => {
    expect(buildArgv(search, {}, { query: "dune part two", res: "1080p", limit: "", "copy-only": true })).toEqual([
      "search", "dune part two", "--res", "1080p", "--copy-only", "--json",
    ]);
    expect(buildArgv(jobRm, { job: "shots" }, { keep: false, tag: "a, b" })).toEqual([
      "job", "shots", "rm", "--no-keep", "--tag", "a", "--tag", "b", "--json",
    ]);
    // A dash-led value for an alsoFlag positional goes as --name=value.
    expect(buildArgv(search, {}, { query: "-x" })).toEqual(["search", "--query=-x", "--json"]);
    expect(commandLine("pm", ["search", "dune part two", "--json"])).toBe("pm search 'dune part two' --json");
  });
});

describe("classification", () => {
  it("flags destructive leaves unless read-only", () => {
    expect(isDestructive(jobRm)).toBe(true);
    expect(isDestructive(run.routes[3]!)).toBe(true); // reset
    expect(isDestructive(pm.routes[3]!)).toBe(true); // prune apply
    expect(isDestructive(pm.routes[2]!)).toBe(false); // prune (dry run)
    expect(isDestructive({ path: ["rm"], meta: { readOnly: true }, flags: [], positionals: [] })).toBe(false);
    expect(isLiveSearch(search)).toBe(true);
    expect(isLiveSearch(add)).toBe(false);
  });
});

describe("output shaping and chains", () => {
  const out = { query: "dune", warnings: [], hits: [{ title: "Dune.2021.1080p", infoHash: "aa", seeders: 3, sizeBytes: 5e9 }] };

  it("picks the array of objects as rows and keeps scalar extras", () => {
    const shaped = shapeOutput(out);
    expect(shaped).toMatchObject({ kind: "rows", key: "hits", extras: { query: "dune" } });
    expect(shapeOutput([1, 2])).toMatchObject({ kind: "rows", key: null });
    expect(shapeOutput({ ok: true })).toEqual({ kind: "value", value: { ok: true } });
    expect(rowTitle(out.hits[0])).toBe("Dune.2021.1080p");
    expect(rowAccessories(out.hits[0])).toEqual([["infoHash", "aa"], ["seeders", "3"], ["sizeBytes", "4.7 GB"]]);
  });

  it("finds commands whose completeFrom points back at this output", () => {
    const chains = chainsFor(pm, search, shapeOutput(out));
    expect(chains.map((c) => [c.route.path.join(" "), c.arg, c.source])).toEqual([["add", "magnet", "positional"]]);
    expect(chains[0]!.valueOf(out.hits[0])).toBe("aa");
    const runChains = chainsFor(run, run.routes[0]!, shapeOutput({ jobs: [{ name: "shots" }] }));
    expect(runChains.map((c) => [c.route.path.join(" "), c.source, c.valueOf({ name: "shots" })])).toEqual([["job :job rm", "path", "shots"]]);
    expect(chainsFor(pm, add, shapeOutput(out))).toEqual([]);
  });

  it("treats a source needing an unsupplied positional as chain-only", () => {
    expect(sourceRunnable(pm, { cmd: "pm search", field: "hits[].magnet" })).toBe(false);
    expect(sourceRunnable(pm, { cmd: "pm search", args: { query: "$query" }, field: "hits[].magnet" })).toBe(true);
    expect(sourceRunnable(run, { cmd: "run ls", field: "jobs[].name" })).toBe(true);
    expect(sourceRunnable(run, { cmd: "run nope", field: "x" })).toBe(false);
  });
});

describe("release titles", () => {
  it("strips quality, codec, source, group, and punctuation", () => {
    expect(normalizeReleaseTitle("Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX[T").completion).toBe("Dune Part Two 2024");
    expect(normalizeReleaseTitle("Dune - Part Two 2024 1080p BluRay x265-GeneMige").completion).toBe("Dune Part Two 2024");
    expect(normalizeReleaseTitle("Dune Part Two (2024) [REPACK] [1080p] [WEBRip] [5.1]").completion).toBe("Dune Part Two 2024");
    expect(normalizeReleaseTitle("The.Bear.S02E05.1080p.WEB.h264-ETHEL").completion).toBe("The Bear S02E05");
    expect(normalizeReleaseTitle("Severance Season 2 Complete 2160p").completion).toBe("Severance S02");
    expect(normalizeReleaseTitle("2001.A.Space.Odyssey.1968.1080p").completion).toBe("2001 A Space Odyssey 1968");
    expect(normalizeReleaseTitle("Show.2019.S03.1080p").completion).toBe("Show 2019 S03");
  });

  it("suggests the most common pattern, best hit by seeders", () => {
    const hits = JSON.parse(readFileSync(new URL("./pm-search-dune.json", import.meta.url), "utf8")).hits;
    const [top] = suggestCompletions(hits);
    expect(top!.completion).toBe("Dune Part Two 2024");
    expect(top!.count).toBeGreaterThan(25);
    expect(top!.best.seeders).toBe(498);
  });
});

describe("typed commands", () => {
  it("tokenizes with quotes", () => {
    expect(tokenize(`search "the dune" --res 1080p`)).toEqual(["search", "the dune", "--res", "1080p"]);
  });
  it("runs a command with nothing required", () => {
    const t = parseTyped(run, "ls");
    expect([t.route?.path, t.ready]).toEqual([["ls"], true]);
  });
  it("fills dynamic segments and flags", () => {
    const t = parseTyped(run, "job nightly rm --no-keep --tag a");
    expect([t.route?.path, t.params, t.values, t.ready]).toEqual([["job", ":job", "rm"], { job: "nightly" }, { keep: false, tag: "a" }, true]);
  });
  it("joins extra words into the last positional and reads flags", () => {
    const t = parseTyped(pm, "search dune 2021 --res=1080p --copy-only");
    expect([t.values, t.ready]).toEqual([{ query: "dune 2021", res: "1080p", "copy-only": true }, true]);
  });
  it("is not ready when a required positional is missing", () => {
    expect(parseTyped(pm, "add --watch").ready).toBe(false);
    expect(runsBare(add, {})).toBe(false);
  });
  it("stops at a group without a command", () => {
    const t = parseTyped(run, "job");
    expect([t.template, t.route]).toEqual([["job"], undefined]);
  });
  it("prefers a static child over a dynamic one", () => {
    expect(parseTyped(pm, "prune apply").route?.path).toEqual(["prune", "apply"]);
  });
});
