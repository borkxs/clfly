import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportSkill } from "../src/skill/export.js";

describe("clfly skill export", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the same SKILL.md on a second export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-skill-"));
    dirs.push(dir);
    mkdirSync(join(dir, "commands"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "ytid",
        description: "Extract a YouTube video id",
        bin: { ytid: "./bin/ytid.mjs" },
      }),
    );
    writeFileSync(
      join(dir, "commands", "id.ts"),
      `export const meta = { description: "Print the video id" };
export default async function () {
  return { id: "ok" };
}
`,
    );
    const out = join(dir, "out");
    const first = await exportSkill({ cwd: dir, outDir: out });
    const second = await exportSkill({ cwd: dir, outDir: out });
    expect(second).toBe(first);
    const body = readFileSync(first, "utf8");
    expect(body).toBe(readFileSync(second, "utf8"));
    expect(body).toContain("name: ytid");
    expect(body).toContain("### id");
    expect(body).toContain("Print the video id");
    expect(body).toContain("node bin/ytid.mjs mcp serve --root .");
  });
});
