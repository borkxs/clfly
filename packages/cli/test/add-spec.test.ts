import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runAdd } from "../src/scaffold/add.js";
import { insertReadmeBullet, parseArgSpec } from "../src/scaffold/spec.js";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A toy monorepo inside this package, so the generated command can import zod. */
function toyRepo() {
  const root = mkdtempSync(join(pkgDir, ".tmp-add-spec-"));
  dirs.push(root);
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  mkdirSync(join(root, "changes"));
  const tree = join(root, "packages", "toy");
  mkdirSync(join(tree, "commands", "ci"), { recursive: true });
  writeFileSync(join(tree, "package.json"), JSON.stringify({ name: "@x/toy", bin: { toy: "./bin/toy.mjs" } }));
  writeFileSync(
    join(tree, "commands", "ci", "ls.ts"),
    'import type { Context } from "@clfly/core";\nimport { z } from "zod";\nexport const args = z.object({});\nexport default async function (_o: unknown, _ctx: Context) {}\n',
  );
  writeFileSync(join(tree, "README.md"), "# toy\n\n## Commands\n\n- `toy ci ls` — lists runs\n\n## More\n");
  const out: string[] = [];
  const ctx = {
    cwd: tree,
    json: false,
    stdout: { write: (s: string) => (out.push(s), true) },
    stderr: { write: () => true },
    resolvePath: (p: string) => resolve(tree, p),
    env: { CLFLY_BRANCH: "feat-a-toy" },
  } as unknown as Parameters<typeof runAdd>[1];
  return { root, tree, ctx, out };
}

describe("parseArgSpec", () => {
  it("parses type, default, optional and description", () => {
    expect(parseArgSpec("lines:int=40:How many lines")).toEqual({ name: "lines", type: "int", default: 40, desc: "How many lines" });
    expect(parseArgSpec("pr?:string")).toEqual({ name: "pr", type: "string", optional: true });
    expect(parseArgSpec("mode:enum(a|b)=b")).toEqual({ name: "mode", type: { enum: ["a", "b"] }, default: "b" });
    expect(parseArgSpec("tags:string[]=x,y")).toMatchObject({ default: ["x", "y"] });
    expect(() => parseArgSpec("n:int=1.5")).toThrow(/int/);
    expect(() => parseArgSpec("bad")).toThrow(/name\[\?\]:type/);
  });

  it("inserts a README bullet after the command list, or not at all", () => {
    expect(insertReadmeBullet("a\n- `t x` — 1\n- `t y` — 2\n\nb", "t", "- `t z` — 3")).toBe(
      "a\n- `t x` — 1\n- `t y` — 2\n- `t z` — 3\n\nb",
    );
    expect(insertReadmeBullet("no list here", "t", "- `t z`")).toBeNull();
  });
});

describe("clfly add --spec", () => {
  it("one call writes command, test, README bullet and changes fragment", async () => {
    const { root, tree, ctx, out } = toyRepo();
    const specFile = join(tree, "spec.json");
    writeFileSync(
      specFile,
      JSON.stringify({ summary: "Show a run's log", args: ["name:string:Slot or PR", "lines:int=40", "follow?:bool"] }),
    );
    const r = await runAdd({ paths: ["ci/tail"], spec: `@${specFile}` }, ctx);
    expect(r.created).toEqual([
      "commands/ci/tail.ts",
      "test/ci-tail.test.ts",
      "README.md",
      "../../changes/feat-a-toy.md",
    ]);
    expect(out.join("")).toBe(r.created.map((f) => `${f}\n`).join(""));

    const cmd = readFileSync(join(tree, "commands/ci/tail.ts"), "utf8");
    expect(cmd).toContain('import type { Context } from "@clfly/core";');
    expect(cmd).toContain('description: "Show a run\'s log"');
    expect(cmd).toContain('name: z.string().describe("Slot or PR"),');
    expect(cmd).toContain("lines: z.coerce.number().int().default(40),");
    expect(cmd).toContain("follow: z.boolean().optional(),");

    const mod = await import(pathToFileURL(join(tree, "commands/ci/tail.ts")).href);
    const res = await mod.default(mod.args.parse({ name: "x" }), { json: true });
    expect(res).toMatchObject({ ok: true, opts: { name: "x", lines: 40 } });

    const test = readFileSync(join(tree, "test/ci-tail.test.ts"), "utf8");
    expect(test).toContain('from "../commands/ci/tail.js"');
    expect(test).toContain('parse({"name":"x"})');
    expect(readFileSync(join(tree, "README.md"), "utf8")).toContain(
      "- `toy ci ls` — lists runs\n- `toy ci tail` — Show a run's log\n\n## More",
    );
    expect(readFileSync(join(root, "changes/feat-a-toy.md"), "utf8")).toBe(
      "- `toy ci tail` — Show a run's log (#PR)\n",
    );
  });

  it("appends to an existing test file and fragment; inline --summary/--arg work too", async () => {
    const { root, tree, ctx } = toyRepo();
    mkdirSync(join(tree, "test"));
    writeFileSync(join(tree, "test/stats.test.ts"), 'import { it } from "vitest";\nit("old", () => {});\n');
    writeFileSync(join(root, "changes/feat-a-toy.md"), "- `toy other` — x (#PR)");
    const r = await runAdd({ paths: ["stats"], summary: "Count runs", arg: ["since:string=7d"] }, ctx);
    expect(r.created).toContain("test/stats.test.ts");
    const test = readFileSync(join(tree, "test/stats.test.ts"), "utf8");
    expect(test.startsWith('import { it } from "vitest";\nit("old"')).toBe(true);
    expect(test).toContain('import * as cmd_stats_vt from "vitest";');
    expect(test).toContain("cmd_stats_vt.expect(out)");
    expect(test).toContain('import cmd_stats, { args as cmd_statsArgs } from "../commands/stats.js";');
    expect(readFileSync(join(root, "changes/feat-a-toy.md"), "utf8")).toBe(
      "- `toy other` — x (#PR)\n- `toy stats` — Count runs (#PR)\n",
    );
    // No Context import in a sibling at the root: the inline ctx type is used.
    expect(readFileSync(join(tree, "commands/stats.ts"), "utf8")).not.toContain("@clfly/core");
  });

  it("skips the README when there is no command list, and keeps plain add unchanged", async () => {
    const { tree, ctx } = toyRepo();
    writeFileSync(join(tree, "README.md"), "# toy\n");
    const r = await runAdd({ paths: ["scan"], summary: "Scan" }, ctx);
    expect(r.created).not.toContain("README.md");
    const plain = await runAdd({ paths: ["plain"] }, ctx);
    expect(plain.created).toEqual(["commands/plain.ts"]);
    expect(existsSync(join(tree, "test/plain.test.ts"))).toBe(false);
    await expect(runAdd({ paths: ["a", "b"], summary: "x" }, ctx)).rejects.toThrow(/exactly one path/);
  });
});
