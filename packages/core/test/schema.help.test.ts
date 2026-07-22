import { describe, expect, it } from "vitest";
import { z } from "zod";
import { projectFlags, toJsonSchema } from "../src/schema/to-json-schema.js";
import { projectPositionals } from "../src/schema/project-positionals.js";
import { assertNoReservedFlags } from "../src/schema/reserved.js";
import { ReservedFlagError } from "../src/errors.js";
import { renderHelp } from "../src/help/render.js";

describe("schema → JSON Schema → help", () => {
  const args = z.object({
    status: z
      .enum(["active", "churned"])
      .optional()
      .describe("Filter by status"),
    limit: z.coerce.number().default(50).describe("Max rows"),
  });

  it("projects to JSON Schema with descriptions", () => {
    const json = toJsonSchema(args);
    expect(json.type).toBe("object");
    const props = json.properties as Record<string, { description?: string }>;
    expect(props.status?.description).toBe("Filter by status");
    expect(props.limit?.description).toBe("Max rows");
  });

  it("snapshots help text", () => {
    const flags = projectFlags(args);
    const help = renderHelp({
      name: "demo",
      commandPath: ["users", "list"],
      meta: {
        description: "List users in the workspace",
        deprecated: "use users search",
      },
      flags,
      positionals: [],
    });
    expect(help).toMatchSnapshot();
  });

  it("snapshots Arguments section for path params (not as flags)", () => {
    const showArgs = z.object({
      id: z.string().describe("User id"),
    });
    const positionals = projectPositionals({
      pathParamNames: ["id"],
      args: showArgs,
    });
    const excluded = new Set(positionals.map((p) => p.name));
    const flags = projectFlags(showArgs).filter((f) => !excluded.has(f.name));
    const help = renderHelp({
      name: "demo",
      commandPath: ["users", "<id>", "show"],
      meta: { description: "Show a single user" },
      flags,
      positionals,
    });
    expect(help).toMatchSnapshot();
    expect(help).toContain("Arguments:");
    expect(help).toContain("(also --id)");
    expect(help).not.toMatch(/Options:[\s\S]*--id/);
  });

  it("snapshots optional + variadic export positionals in synopsis", () => {
    const positionals = projectPositionals({
      pathParamNames: [],
      positionals: z.object({
        query: z.string().optional().describe("Search query"),
        paths: z.array(z.string()).optional().describe("File paths"),
      }),
    });
    const help = renderHelp({
      name: "demo",
      commandPath: ["search"],
      meta: { description: "Search the workspace" },
      flags: [],
      positionals,
    });
    expect(help).toMatchSnapshot();
    expect(help).toContain("[query]");
    expect(help).toContain("[paths...]");
  });

  it("hard-errors on reserved flag names", () => {
    const flags = projectFlags(
      z.object({
        version: z.boolean().optional(),
      }),
    );
    expect(() => assertNoReservedFlags(["users", "list"], flags)).toThrow(
      ReservedFlagError,
    );
  });

  it("hard-errors on reserved json flag", () => {
    const flags = projectFlags(
      z.object({
        json: z.boolean().optional(),
      }),
    );
    expect(() => assertNoReservedFlags(["users", "list"], flags)).toThrow(
      ReservedFlagError,
    );
  });

  it("hard-errors on reserved aliases", () => {
    const flags = projectFlags(
      z.object({
        verbose: z.boolean().optional().meta({ alias: "h" }),
      }),
    );
    expect(() => assertNoReservedFlags(["deploy"], flags)).toThrow(
      ReservedFlagError,
    );
  });
});
