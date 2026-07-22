import { execFile } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCommandPathDsl } from "../src/scaffold/add.js";

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "dist", "bin.js");
const tsupBin = join(root, "node_modules", "tsup", "dist", "cli-default.js");

async function run(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bin, ...args], {
      encoding: "utf8",
      cwd,
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

describe("parseCommandPathDsl", () => {
  it("accepts :param and [param]", () => {
    expect(parseCommandPathDsl("user/:id/report")).toEqual({
      diskSegments: ["user", "[id]", "report"],
      manifestPath: ["user", ":id", "report"],
    });
    expect(parseCommandPathDsl("user/[id]/report").manifestPath).toEqual([
      "user",
      ":id",
      "report",
    ]);
  });

  it("maps index leaf to empty/parent manifest path", () => {
    expect(parseCommandPathDsl("index").manifestPath).toEqual([]);
    expect(parseCommandPathDsl("user/index").manifestPath).toEqual(["user"]);
  });
});

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
    expect(stdout).toBe("0.0.4\n");
  });

  it("--help lists real commands", async () => {
    const { stdout, code } = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("init");
    expect(stdout).toContain("add");
    expect(stdout).toContain("build");
    expect(stdout).toContain("completions");
    expect(stdout).toContain("mcp");
    expect(stdout).not.toMatch(/\badd\.d\b/);
    expect(stdout).not.toMatch(/\bbuild\.d\b/);
  });

  it("bare invocation prints help when there is no root index", async () => {
    const { stdout, stderr, code } = await run([]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Usage: clfly");
    expect(stdout).toContain("init");
    expect(stdout).not.toMatch(/Unknown command/);
  });

  it("init scaffolds a runnable project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-init-"));
    try {
      const { stdout, code } = await run(
        ["init", "demo", "--pm", "npm", "--json"],
        dir,
      );
      expect(code).toBe(0);
      const payload = JSON.parse(stdout) as { created: string[] };
      expect(payload.created.some((p) => p.endsWith("commands/hello.ts"))).toBe(
        true,
      );
      expect(existsSync(join(dir, "demo", "commands", "hello.ts"))).toBe(true);
      expect(existsSync(join(dir, "demo", "bin", "demo.ts"))).toBe(true);
      const pkg = JSON.parse(
        readFileSync(join(dir, "demo", "package.json"), "utf8"),
      ) as { clfly: { validator: string }; bin: Record<string, string> };
      expect(pkg.clfly.validator).toBe("zod");
      expect(pkg.bin.demo).toBe("./bin/demo.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("add creates files all-or-nothing and rejects collisions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-add-"));
    try {
      const init = await run(["init", "app", "--json"], dir);
      expect(init.code).toBe(0);
      const app = join(dir, "app");

      const ok = await run(
        ["add", "user/list", "user/:id/report", "--json"],
        app,
      );
      expect(ok.code).toBe(0);
      const created = JSON.parse(ok.stdout) as { created: string[] };
      expect(created.created).toEqual([
        "commands/user/list.ts",
        "commands/user/[id]/report.ts",
      ]);
      expect(existsSync(join(app, "commands/user/list.ts"))).toBe(true);
      expect(existsSync(join(app, "commands/user/[id]/report.ts"))).toBe(true);

      const collide = await run(["add", "user/list", "--json"], app);
      expect(collide.code).toBe(2);
      expect(collide.stderr).toMatch(/already exists|validation failed/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("add rejects tool-name collisions in a batch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-collide-"));
    try {
      await run(["init", "app", "--json"], dir);
      const app = join(dir, "app");
      const bad = await run(["add", "users/list", "users_list", "--json"], app);
      expect(bad.code).toBe(2);
      expect(bad.stderr).toMatch(/tool name collision/i);
      expect(existsSync(join(app, "commands/users/list.ts"))).toBe(false);
      expect(existsSync(join(app, "commands/users_list.ts"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("init --force never overwrites existing files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-force-"));
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "README.md"), "keep me\n", "utf8");
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "existing", version: "1.0.0" }, null, 2),
      );
      const { code, stderr } = await run(
        ["init", "--force", "--json"],
        dir,
      );
      expect(code).toBe(0);
      expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("keep me\n");
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name: string;
        dependencies?: Record<string, string>;
      };
      expect(pkg.name).toBe("existing");
      expect(pkg.dependencies?.["@clfly/core"]).toBeTruthy();
      expect(existsSync(join(dir, "commands/hello.ts"))).toBe(true);
      void stderr;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
