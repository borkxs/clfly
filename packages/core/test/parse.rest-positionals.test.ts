import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assignRestPositionals } from "../src/parse/rest-positionals.js";
import type { PositionalInfo } from "../src/types.js";

const searchArgs = z.object({
  query: z.string(),
  res: z.enum(["720p", "1080p"]).optional(),
  "max-size": z.string().optional(),
});
const queryPositional: PositionalInfo[] = [
  { name: "query", source: "export", optional: false, alsoFlag: true },
];

describe("assignRestPositionals", () => {
  it("fills declared positionals only", () => {
    const out = assignRestPositionals({}, ["the village"], searchArgs, queryPositional);
    expect(out).toEqual({ args: { query: "the village" }, leftover: [] });
  });

  it("never spills extra tokens into string flags when positionals are declared", () => {
    // `pm search get "The Village 2004"` used to land the title in --res.
    const out = assignRestPositionals(
      {},
      ["get", "The Village 2004"],
      searchArgs,
      queryPositional,
    );
    expect(out.args).toEqual({ query: "get" });
    expect(out.leftover).toEqual(["The Village 2004"]);
  });

  it("gives a variadic positional the rest", () => {
    const args = z.object({ paths: z.array(z.string()), mode: z.string().optional() });
    const out = assignRestPositionals({}, ["a", "b", "c"], args, [
      { name: "paths", source: "export", optional: true, variadic: true },
    ]);
    expect(out).toEqual({ args: { paths: ["a", "b", "c"] }, leftover: [] });
  });

  it("keeps legacy zipping without a positionals export, and reports overflow", () => {
    const args = z.object({ name: z.string(), count: z.number().optional() });
    expect(assignRestPositionals({}, ["x"], args)).toEqual({
      args: { name: "x" },
      leftover: [],
    });
    expect(assignRestPositionals({}, ["x", "y"], args).leftover).toEqual(["y"]);
  });

  it("reports every token as leftover for a command with no args schema", () => {
    expect(assignRestPositionals({}, ["x"], undefined).leftover).toEqual(["x"]);
  });
});
