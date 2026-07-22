import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createCli } from "../src/run.js";
import {
  assertManifestCompatible,
  MANIFEST_FORMAT_VERSION,
} from "../src/index.js";
import { ManifestVersionError } from "../src/errors.js";

function collectStream() {
  let data = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      data += String(chunk);
      cb();
    },
  });
  return {
    stream,
    text: () => data,
  };
}

const demoCommands = fileURLToPath(
  new URL("../../../examples/demo-cli/commands", import.meta.url),
);
const demoPkg = fileURLToPath(
  new URL("../../../examples/demo-cli/package.json", import.meta.url),
);
const demoBin = fileURLToPath(
  new URL("../../../examples/demo-cli/bin/demo.ts", import.meta.url),
);

describe("createCli integration", () => {
  it("prints bare version", async () => {
    const out = collectStream();
    const err = collectStream();
    const cli = createCli({
      name: "demo",
      commandsDir: demoCommands,
      packageJsonPath: demoPkg,
      stdout: out.stream,
      stderr: err.stream,
    });
    const result = await cli.run(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(out.text()).toBe("1.2.3\n");
    expect(err.text()).toBe("");
  });

  it("ignores end-of-options -- marker", async () => {
    const out = collectStream();
    const cli = createCli({
      name: "demo",
      commandsDir: demoCommands,
      packageJsonPath: demoPkg,
      stdout: out.stream,
      stderr: collectStream().stream,
    });
    const result = await cli.run(["--", "users", "list", "--status", "active"]);
    expect(result.exitCode).toBe(0);
    expect(out.text()).toContain("u_1");
  });

  it("lists users", async () => {
    const out = collectStream();
    const cli = createCli({
      name: "demo",
      commandsDir: demoCommands,
      packageJsonPath: demoPkg,
      stdout: out.stream,
      stderr: collectStream().stream,
    });
    const result = await cli.run(["users", "list", "--status", "active"]);
    expect(result.exitCode).toBe(0);
    expect(out.text()).toContain("u_1");
    expect(out.text()).not.toContain("u_2");
  });

  it("shows user via dynamic segment", async () => {
    const out = collectStream();
    const cli = createCli({
      name: "demo",
      commandsDir: demoCommands,
      packageJsonPath: demoPkg,
      stdout: out.stream,
      stderr: collectStream().stream,
    });
    const result = await cli.run(["users", "u_99", "show"]);
    expect(result.exitCode).toBe(0);
    expect(out.text()).toContain("u_99");
  });

  it("prints help for a command", async () => {
    const out = collectStream();
    const cli = createCli({
      name: "demo",
      commandsDir: demoCommands,
      packageJsonPath: demoPkg,
      stdout: out.stream,
      stderr: collectStream().stream,
    });
    const result = await cli.run(["users", "list", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(out.text()).toContain("List users in the workspace");
    expect(out.text()).toContain("--status");
  });

  it("runs root index on bare argv", async () => {
    const out = collectStream();
    const cli = createCli({
      name: "demo",
      commandsDir: demoCommands,
      packageJsonPath: demoPkg,
      stdout: out.stream,
      stderr: collectStream().stream,
    });
    const result = await cli.run([]);
    expect(result.exitCode).toBe(0);
    expect(out.text()).toContain("demo — try");
  });

  it("reports validation errors with flag + help excerpt", async () => {
    const err = collectStream();
    const cli = createCli({
      name: "demo",
      commandsDir: demoCommands,
      packageJsonPath: demoPkg,
      stdout: collectStream().stream,
      stderr: err.stream,
    });
    const result = await cli.run(["users", "list", "--status", "nope"]);
    expect(result.exitCode).toBe(1);
    expect(err.text()).toContain("--status");
    expect(err.text()).toMatch(/active|churned/);
    expect(err.text()).toContain("Options:");
  });
});

describe("manifest format guard", () => {
  it("hard-fails on format mismatch", () => {
    expect(() =>
      assertManifestCompatible(
        {
          formatVersion: 999,
          coreMajor: 0,
          routes: [],
        },
        "0.1.0",
      ),
    ).toThrow(ManifestVersionError);
  });

  it("accepts current format", () => {
    expect(() =>
      assertManifestCompatible(
        {
          formatVersion: MANIFEST_FORMAT_VERSION,
          coreMajor: 0,
          routes: [],
        },
        "0.1.0",
      ),
    ).not.toThrow();
  });
});

describe("e2e spawn demo-cli", () => {
  it("runs via tsx", async () => {
    const { stdout, code } = await spawnTsx(demoBin, ["--version"]);
    expect(code).toBe(0);
    expect(stdout).toBe("1.2.3\n");
  });

  it("runs users list --json", async () => {
    const { stdout, code } = await spawnTsx(demoBin, [
      "users",
      "list",
      "--json",
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as unknown[];
    expect(parsed.length).toBeGreaterThan(0);
  });
});

function spawnTsx(
  script: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../node_modules/tsx/dist/cli.mjs",
        ),
        script,
        ...args,
      ],
      {
        env: process.env,
        cwd: dirname(dirname(script)),
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += String(c);
    });
    child.stderr.on("data", (c) => {
      stderr += String(c);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}
