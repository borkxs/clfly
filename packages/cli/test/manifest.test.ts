import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runManifest } from "../src/registry/manifest.js";
import { writeRegistry } from "../src/registry/store.js";
import { registryPath } from "../src/registry/paths.js";

let tmp: string;
let env: NodeJS.ProcessEnv;

function tree(name: string, files: Record<string, string>) {
  const root = join(tmp, name);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return {
    path: root,
    bin: join(root, "bin", `${name}.mjs`),
    name,
    coreVersion: "0.3.0",
    manifest: null,
    root,
    linkedAt: "2026-11-02T00:00:00.000Z",
    registered: {},
  };
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "clfly-manifest-")));
  env = { HOME: join(tmp, "home"), CLFLY_HOME: join(tmp, "clfly") };
  writeRegistry(registryPath(env), {
    formatVersion: 1,
    trees: {
      jobs: tree("jobs", {
        "package.json": JSON.stringify({ name: "jobs", description: "Job runner" }),
        "commands/ls.ts": "export const meta = { readOnly: true };\nexport default (): string[] => [];\n",
        "commands/[job]/rm.ts": `export const complete = { job: { cmd: "jobs ls", field: "[]" } };
export const meta = { destructive: true };
export default () => null;
`,
      }),
      broken: tree("broken", { "package.json": "{}" }),
      nested: tree("nested", { "src/commands/index.mjs": "export default () => 1;\n" }),
    },
  });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("clfly manifest", () => {
  it("builds every linked tree, carrying completeFrom and reporting failures per tree", async () => {
    const { trees } = await runManifest({ env });
    expect(trees.map((t) => t.name)).toEqual(["broken", "jobs", "nested"]);
    const [broken, jobs, nested] = trees;
    expect(broken!.error).toMatch(/No commands\//);
    expect(nested!.commandsDir).toBe(join(tmp, "nested", "src", "commands"));
    expect(nested!.routes.map((r) => r.path)).toEqual([[]]);
    expect(jobs!.description).toBe("Job runner");
    expect(jobs!.bin).toBe(join(tmp, "jobs", "bin", "jobs.mjs"));
    const rm = jobs!.routes.find((r) => r.path.join(" ") === ":job rm")!;
    expect(rm.meta).toEqual({ destructive: true });
    expect(rm.positionals[0]).toMatchObject({ name: "job", source: "path", completeFrom: { cmd: "jobs ls", field: "[]" } });
    expect(rm).not.toHaveProperty("load");
  });

  it("builds one tree by name and rejects an unknown one", async () => {
    const { trees } = await runManifest({ env, name: "jobs" });
    expect(trees).toHaveLength(1);
    await expect(runManifest({ env, name: "nope" })).rejects.toThrow(/No linked tree named "nope"/);
  });
});
