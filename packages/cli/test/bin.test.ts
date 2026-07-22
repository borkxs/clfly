import { execFile } from "node:child_process";
import { accessSync, chmodSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "dist", "bin.js");
const tsupBin = join(root, "node_modules", "tsup", "dist", "cli-default.js");
const REPO_URL = "https://github.com/borkxs/clfly";

async function run(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bin, ...args], {
      encoding: "utf8",
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}

describe("clfly bin", () => {
  beforeAll(async () => {
    await execFileAsync(process.execPath, [tsupBin], {
      cwd: root,
      encoding: "utf8",
    });
    chmodSync(bin, 0o755);
    accessSync(bin, constants.X_OK);
  });

  it("--version prints bare package version", async () => {
    const { stdout, stderr, code } = await run(["--version"]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe("0.0.2\n");
  });

  it("-V matches --version", async () => {
    const { stdout, code } = await run(["-V"]);
    expect(code).toBe(0);
    expect(stdout).toBe("0.0.2\n");
  });

  it("--help includes the repo URL", async () => {
    const { stdout, code } = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain(REPO_URL);
    expect(stdout).toContain("coming soon");
  });

  it("no args shows help", async () => {
    const { stdout, code } = await run([]);
    expect(code).toBe(0);
    expect(stdout).toContain(REPO_URL);
  });

  it("unknown command exits 2 with help", async () => {
    const { stdout, stderr, code } = await run(["build"]);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown command: build");
    expect(stdout).toContain(REPO_URL);
  });
});
