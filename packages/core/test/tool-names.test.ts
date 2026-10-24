import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertUniqueToolNames,
  toolNameFromPath,
} from "../src/mcp/tool-names.js";
import { ClflyError } from "../src/errors.js";
import { createCli } from "../src/run.js";

describe("assertUniqueToolNames", () => {
  it("hard-fails on users/list vs users_list", () => {
    expect(() =>
      assertUniqueToolNames([
        { path: ["users", "list"], file: "commands/users/list.ts" },
        { path: ["users_list"], file: "commands/users_list.ts" },
      ]),
    ).toThrow(/tool name collision: "users_list"/);
  });

  it("skips root index", () => {
    expect(toolNameFromPath([])).toBeNull();
    expect(() =>
      assertUniqueToolNames([{ path: [], file: "commands/index.ts" }]),
    ).not.toThrow();
  });

  it("keeps a trailing param child distinct from the bare command", () => {
    expect(toolNameFromPath(["down"])).toBe("down");
    expect(toolNameFromPath(["down", ":env"])).toBe("down_env");
    expect(toolNameFromPath(["users", ":id", "show"])).toBe("users_show");
    expect(() =>
      assertUniqueToolNames([
        { path: ["down"], file: "commands/down/index.ts" },
        { path: ["down", ":env"], file: "commands/down/[env].ts" },
      ]),
    ).not.toThrow();
  });

  it("createCli hard-fails on colliding command files", () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-name-"));
    try {
      mkdirSync(join(dir, "users"), { recursive: true });
      writeFileSync(join(dir, "users", "list.ts"), "export default async function () {}");
      writeFileSync(join(dir, "users_list.ts"), "export default async function () {}");
      expect(() => createCli({ name: "x", commandsDir: dir })).toThrow(ClflyError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
