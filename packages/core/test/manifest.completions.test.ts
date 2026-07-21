import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildManifest } from "../src/build/manifest.js";
import { createCli } from "../src/run.js";
import { generateCompletions } from "../src/completions/generate.js";
import { treeFromManifest } from "../src/manifest/load.js";
import { MANIFEST_FORMAT_VERSION } from "../src/types.js";
import { ManifestVersionError } from "../src/errors.js";
import { Writable } from "node:stream";

const demoCommands = fileURLToPath(
  new URL("../../../examples/demo-cli/commands", import.meta.url),
);
const demoPkg = fileURLToPath(
  new URL("../../../examples/demo-cli/package.json", import.meta.url),
);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function collectStream() {
  let data = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      data += String(chunk);
      cb();
    },
  });
  return { stream, text: () => data };
}

describe("buildManifest", () => {
  it("emits a lazy manifest with formatVersion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-manifest-"));
    tempDirs.push(dir);
    const outFile = join(dir, "manifest.js");

    const result = await buildManifest({
      commandsDir: demoCommands,
      outFile,
      coreVersion: "0.1.0",
    });

    expect(result.routeCount).toBeGreaterThanOrEqual(3);
    expect(result.manifest.formatVersion).toBe(MANIFEST_FORMAT_VERSION);
    expect(result.manifest.coreMajor).toBe(0);

    const source = readFileSync(outFile, "utf8");
    expect(source).toContain("formatVersion: 1");
    expect(source).toContain("load: () => import(");
    expect(source).toContain("users/list");
  });

  it("runs createCli from a loaded manifest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-manifest-run-"));
    tempDirs.push(dir);
    const outFile = join(dir, "manifest.js");

    const { manifest } = await buildManifest({
      commandsDir: demoCommands,
      outFile,
      coreVersion: "0.1.0",
    });

    const out = collectStream();
    const cli = createCli({
      name: "demo",
      manifest,
      packageJsonPath: demoPkg,
      stdout: out.stream,
      stderr: collectStream().stream,
    });
    const result = await cli.run(["users", "list", "--status", "active"]);
    expect(result.exitCode).toBe(0);
    expect(out.text()).toContain("u_1");
  });

  it("hard-fails when runtime formatVersion mismatches", () => {
    expect(() =>
      treeFromManifest(
        {
          formatVersion: 999,
          coreMajor: 0,
          routes: [],
        },
        "0.1.0",
      ),
    ).toThrow(ManifestVersionError);
  });
});

describe("completions", () => {
  it("generates bash/zsh/fish scripts from the manifest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-comp-"));
    tempDirs.push(dir);
    const { manifest } = await buildManifest({
      commandsDir: demoCommands,
      outFile: join(dir, "manifest.js"),
      coreVersion: "0.1.0",
    });

    const bash = generateCompletions({ name: "demo", manifest, shell: "bash" });
    expect(bash).toContain("complete -F _demo_clfly demo");
    expect(bash).toContain("--json");
    expect(bash).toContain("users");

    const zsh = generateCompletions({ name: "demo", manifest, shell: "zsh" });
    expect(zsh).toContain("#compdef demo");
    expect(zsh).toContain("--json[Emit JSON]");

    const fish = generateCompletions({ name: "demo", manifest, shell: "fish" });
    expect(fish).toContain("complete -c demo");
    expect(fish).toContain("-l json");
    expect(fish).toMatchSnapshot();
  });
});

describe("--json convention", () => {
  it("serializes returned command data", async () => {
    const out = collectStream();
    const cli = createCli({
      name: "demo",
      commandsDir: demoCommands,
      packageJsonPath: demoPkg,
      stdout: out.stream,
      stderr: collectStream().stream,
    });
    const result = await cli.run(["users", "list", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(out.text()) as Array<{ id: string }>;
    expect(parsed[0]?.id).toBe("u_1");
  });

  it("emits structured validation errors", async () => {
    const err = collectStream();
    const cli = createCli({
      name: "demo",
      commandsDir: demoCommands,
      packageJsonPath: demoPkg,
      stdout: collectStream().stream,
      stderr: err.stream,
    });
    const result = await cli.run([
      "users",
      "list",
      "--json",
      "--status",
      "nope",
    ]);
    expect(result.exitCode).toBe(1);
    const body = JSON.parse(err.text()) as {
      error: { message: string; issues: unknown[] };
    };
    expect(body.error.message).toBe("Invalid arguments");
    expect(body.error.issues.length).toBeGreaterThan(0);
  });
});
