import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createCli } from "../src/run.js";
import { buildManifest } from "../src/build/manifest.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

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

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function helpFor(argv: string[]): Promise<string> {
  const out = collectStream();
  const cli = createCli({
    name: "demo",
    commandsDir: demoCommands,
    packageJsonPath: demoPkg,
    stdout: out.stream,
    stderr: collectStream().stream,
  });
  const result = await cli.run(argv);
  expect(result.exitCode).toBe(0);
  return out.text();
}

describe("demo-cli help snapshots", () => {
  it("root --help", async () => {
    expect(await helpFor(["--help"])).toMatchSnapshot();
  });

  it("deploy --help", async () => {
    expect(await helpFor(["deploy", "--help"])).toMatchSnapshot();
  });

  it("users list --help", async () => {
    expect(await helpFor(["users", "list", "--help"])).toMatchSnapshot();
  });

  it("users <id> show --help (path param as Argument, not Option)", async () => {
    const help = await helpFor(["users", "u_1", "show", "--help"]);
    expect(help).toMatchSnapshot();
    expect(help).toContain("Arguments:");
    expect(help).toContain("<id>");
    expect(help).toContain("(also --id)");
    expect(help).not.toMatch(/Options:[\s\S]*--id <value>/);
  });
});

describe("demo-cli unknown option suggestions", () => {
  it("suggests nearest flag", async () => {
    const err = collectStream();
    const cli = createCli({
      name: "demo",
      commandsDir: demoCommands,
      packageJsonPath: demoPkg,
      stdout: collectStream().stream,
      stderr: err.stream,
    });
    const result = await cli.run(["users", "list", "--statu", "active"]);
    expect(result.exitCode).toBe(1);
    expect(err.text()).toContain("Unknown option: --statu");
    expect(err.text()).toContain("Did you mean: --status?");
  });
});

describe("manifest positionals projection", () => {
  it("marks path params on show distinctly from flags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-pos-"));
    tempDirs.push(dir);
    const { manifest } = await buildManifest({
      commandsDir: demoCommands,
      outFile: join(dir, "manifest.js"),
      coreVersion: "0.1.0",
    });
    const show = manifest.routes.find(
      (r) => r.path[0] === "users" && r.path.includes(":id"),
    );
    expect(show).toBeDefined();
    expect(show!.positionals).toEqual([
      {
        name: "id",
        source: "path",
        optional: false,
        description: "User id",
        alsoFlag: true,
      },
    ]);
    expect(show!.flags.find((f) => f.name === "id")).toBeUndefined();

    const list = manifest.routes.find(
      (r) => r.path.join("/") === "users/list",
    );
    expect(list!.positionals).toEqual([]);
    expect(list!.flags.map((f) => f.name).sort()).toEqual(["limit", "status"]);
  });
});
