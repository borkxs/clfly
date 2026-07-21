import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mapToArgs, tokenize } from "../src/parse/tokenize.js";
import { projectFlags } from "../src/schema/to-json-schema.js";

describe("tokenize", () => {
  const flags = projectFlags(
    z.object({
      status: z.enum(["active", "churned"]).optional().describe("Filter"),
      limit: z.coerce.number().default(50),
      json: z.boolean().default(false),
      verbose: z.boolean().default(false).meta({ alias: "v" }),
    }),
  );

  it("parses long flags and boolean", () => {
    const result = tokenize(
      ["--status", "active", "--json", "--limit", "10"],
      flags,
    );
    expect(result.flags).toMatchObject({
      status: "active",
      json: true,
      limit: "10",
    });
    expect(result.positionals).toEqual([]);
  });

  it("parses --key=value and --no-flag", () => {
    const result = tokenize(["--status=churned", "--no-json"], flags);
    expect(result.flags.status).toBe("churned");
    expect(result.flags.json).toBe(false);
  });

  it("parses aliases", () => {
    const result = tokenize(["-v"], flags);
    expect(result.flags.verbose).toBe(true);
  });

  it("collects leftover positionals", () => {
    const result = tokenize(["rest1", "rest2", "--json"], flags);
    expect(result.positionals).toEqual(["rest1", "rest2"]);
    expect(result.flags.json).toBe(true);
  });
});

describe("mapToArgs", () => {
  it("merges path params and flags", () => {
    const mapped = mapToArgs({
      pathParams: { id: "u_9" },
      pathParamNames: ["id"],
      positionals: [],
      flags: { json: true },
    });
    expect(mapped).toEqual({ id: "u_9", json: true });
  });
});
