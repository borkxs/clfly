import { describe, expect, it } from "vitest";
import { z } from "zod";
import { projectFlags, toJsonSchema } from "../src/schema/to-json-schema.js";
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
    json: z.boolean().default(false).describe("Emit JSON"),
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
      pathParamNames: [],
    });
    expect(help).toMatchSnapshot();
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
