import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanCommandsDir } from "../src/router/scan.js";
import {
  listSubcommands,
  listSubcommandsDetailed,
  resolveRoute,
} from "../src/router/resolve.js";
import { ClflyError } from "../src/errors.js";

function fixtureTree(): string {
  const root = mkdtempSync(join(tmpdir(), "clfly-router-"));
  const commands = join(root, "commands");
  mkdirSync(join(commands, "users", "[id]"), { recursive: true });
  writeFileSync(join(commands, "index.ts"), "export default async () => {}");
  writeFileSync(
    join(commands, "deploy.ts"),
    `export const meta = { description: "Deploy stuff" };
export default async () => {}`,
  );
  writeFileSync(
    join(commands, "users", "list.ts"),
    `export const meta = { description: "List users" };
export default async () => {}`,
  );
  writeFileSync(
    join(commands, "users", "[id]", "show.ts"),
    "export default async () => {}",
  );
  return commands;
}

describe("router resolve", () => {
  const commandsDir = fixtureTree();
  const tree = scanCommandsDir(commandsDir);

  it("resolves root index", () => {
    const r = resolveRoute(tree, []);
    expect(r.node.commandFile?.endsWith("index.ts")).toBe(true);
    expect(r.commandPath).toEqual([]);
  });

  it("resolves static leaf", () => {
    const r = resolveRoute(tree, ["deploy"]);
    expect(r.commandPath).toEqual(["deploy"]);
    expect(r.rest).toEqual([]);
  });

  it("resolves nested static", () => {
    const r = resolveRoute(tree, ["users", "list", "--json"]);
    expect(r.commandPath).toEqual(["users", "list"]);
    expect(r.rest).toEqual(["--json"]);
  });

  it("resolves dynamic segment", () => {
    const r = resolveRoute(tree, ["users", "u_42", "show"]);
    expect(r.commandPath).toEqual(["users", "<id>", "show"]);
    expect(r.pathParams).toEqual({ id: "u_42" });
  });

  it("errors on unknown command", () => {
    expect(() => resolveRoute(tree, ["nope"])).toThrow(ClflyError);
  });

  it("suggests nearest command via Levenshtein", () => {
    expect(() => resolveRoute(tree, ["deply"])).toThrow(/Did you mean: deploy/);
    expect(() => resolveRoute(tree, ["users", "lst"])).toThrow(
      /Did you mean: list/,
    );
  });

  it("skips TypeScript declaration emit next to command modules", () => {
    const root = mkdtempSync(join(tmpdir(), "clfly-dts-"));
    const commands = join(root, "commands");
    mkdirSync(commands, { recursive: true });
    writeFileSync(join(commands, "add.js"), "export default async () => {}");
    writeFileSync(join(commands, "add.d.ts"), "export {};");
    writeFileSync(join(commands, "build.d.ts"), "export {};");
    const scanned = scanCommandsDir(commands);
    expect([...scanned.children.keys()].sort()).toEqual(["add"]);
    expect(scanned.children.get("add")?.commandFile?.endsWith("add.js")).toBe(
      true,
    );
  });

  it("listSubcommandsDetailed loads meta.description in dev scan", async () => {
    const listed = await listSubcommandsDetailed(tree);
    expect(listed.find((c) => c.name === "deploy")?.description).toBe(
      "Deploy stuff",
    );
    // Group nodes without an index have no description.
    expect(listed.find((c) => c.name === "users")?.description).toBeUndefined();

    const users = tree.children.get("users")!;
    const nested = await listSubcommandsDetailed(users);
    expect(nested.find((c) => c.name === "list")?.description).toBe(
      "List users",
    );
  });

  it("listSubcommands prefers manifestMeta without loading", () => {
    const child = tree.children.get("deploy")!;
    child.manifestMeta = { description: "From manifest" };
    expect(listSubcommands(tree).find((c) => c.name === "deploy")?.description).toBe(
      "From manifest",
    );
    delete child.manifestMeta;
  });
});
