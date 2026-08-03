/**
 * Runs docs/spec/fixtures against @clfly/core.
 * Pending cases (stdin merge/bind) are skipped until that feature lands.
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createCli } from "../src/run.js";
import {
  invokeMcpTool,
  listMcpTools,
  projectMcpOutputSchema,
} from "../src/mcp/project.js";
import { toOutputJsonSchema } from "../src/schema/to-json-schema.js";
import type { AnySchema } from "../src/types.js";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/spec/fixtures",
);

type JsonSchema = Record<string, unknown>;

interface FixtureModule {
  meta?: { description?: string; interactive?: boolean };
  args?: JsonSchema;
  output?: JsonSchema;
  returns?: unknown;
  returnsUndefined?: boolean;
}

interface FixtureExpect {
  exitCode?: number;
  stderrMessageIncludes?: string;
  stdoutJson?: unknown;
  assembledArgs?: Record<string, unknown>;
  structuredContent?: Record<string, unknown>;
  structuredContentAbsent?: boolean;
  mcpOutputSchema?: JsonSchema;
  manifestOutputSchema?: JsonSchema;
  isError?: boolean;
  errorMessageIncludes?: string;
}

interface FixtureCase {
  id: string;
  status: "active" | "pending";
  transport: "cli" | "mcp";
  module: FixtureModule;
  argv?: string[];
  stdin?: string;
  stdinIsTTY?: boolean;
  mcpArgs?: Record<string, unknown>;
  expect: FixtureExpect;
}

interface FixtureFile {
  rule: string;
  summary?: string;
  cases: FixtureCase[];
}

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function loadFixtureFiles(): Array<{ file: string; doc: FixtureFile }> {
  if (!existsSync(fixturesDir)) return [];
  return readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".json"))
    .map((file) => ({
      file,
      doc: JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as FixtureFile,
    }));
}

function zodFromJsonSchema(schema: JsonSchema): AnySchema {
  const t = schema.type;
  if (t === "array") {
    const items = schema.items as JsonSchema | undefined;
    return z.array(items ? zodFromJsonSchema(items) : z.unknown()) as AnySchema;
  }
  if (t === "object" || schema.properties) {
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set(
      Array.isArray(schema.required) ? (schema.required as string[]) : [],
    );
    const shape: Record<string, z.ZodType> = {};
    for (const [key, prop] of Object.entries(props)) {
      let field = zodFromJsonSchema(prop) as z.ZodType;
      if (Array.isArray(prop.enum)) {
        field = z.enum(prop.enum as [string, ...string[]]);
      }
      if (prop.default !== undefined) {
        field = field.default(prop.default) as z.ZodType;
      }
      if (!required.has(key) && prop.default === undefined) {
        field = field.optional();
      }
      shape[key] = field;
    }
    return z.object(shape) as AnySchema;
  }
  if (Array.isArray(schema.enum)) {
    return z.enum(schema.enum as [string, ...string[]]) as AnySchema;
  }
  if (t === "string") return z.string() as AnySchema;
  if (t === "boolean") return z.boolean() as AnySchema;
  if (t === "number" || t === "integer") return z.number() as AnySchema;
  return z.unknown() as AnySchema;
}

function materializeCommand(mod: FixtureModule): string {
  const dir = mkdtempSync(join(tmpdir(), "clfly-conform-"));
  temps.push(dir);
  const returnsExpr = mod.returnsUndefined
    ? "undefined"
    : JSON.stringify(mod.returns ?? null);

  writeFileSync(
    join(dir, "cmd.ts"),
    `import { z } from "zod";
export const meta = ${JSON.stringify(mod.meta ?? { description: "cmd" })};
export const args = ${schemaToZodSource(mod.args ?? { type: "object", properties: {} })};
${
  mod.output
    ? `export const output = ${schemaToZodSource(mod.output)};`
    : ""
}
export default async function () {
  return ${returnsExpr};
}
`,
    "utf8",
  );
  return dir;
}

/** Emit Zod source for the restricted fixture JSON Schema subset. */
function schemaToZodSource(schema: JsonSchema): string {
  const t = schema.type;
  if (t === "array") {
    const items = schema.items as JsonSchema | undefined;
    return `z.array(${items ? schemaToZodSource(items) : "z.unknown()"})`;
  }
  if (t === "object" || schema.properties) {
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set(
      Array.isArray(schema.required) ? (schema.required as string[]) : [],
    );
    const fields = Object.entries(props).map(([key, prop]) => {
      let expr = schemaToZodSource(prop);
      if (Array.isArray(prop.enum)) {
        expr = `z.enum(${JSON.stringify(prop.enum)})`;
      }
      if (prop.default !== undefined) {
        expr = `${expr}.default(${JSON.stringify(prop.default)})`;
      } else if (!required.has(key)) {
        expr = `${expr}.optional()`;
      }
      return `  ${JSON.stringify(key)}: ${expr}`;
    });
    return `z.object({\n${fields.join(",\n")}\n})`;
  }
  if (Array.isArray(schema.enum)) {
    return `z.enum(${JSON.stringify(schema.enum)})`;
  }
  if (t === "string") return "z.string()";
  if (t === "boolean") return "z.boolean()";
  if (t === "number" || t === "integer") return "z.number()";
  return "z.unknown()";
}

function collectStream() {
  const chunks: string[] = [];
  return {
    stream: {
      write(chunk: string | Uint8Array) {
        chunks.push(String(chunk));
        return true;
      },
    } as NodeJS.WritableStream,
    text: () => chunks.join(""),
  };
}

function normalizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(normalizeSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (k === "$schema") continue;
      if (k === "additionalProperties" && v === false) continue;
      out[k] = normalizeSchema(v);
    }
    return out;
  }
  return schema;
}

async function runCliCase(c: FixtureCase) {
  const dir = materializeCommand(c.module);
  const stdout = collectStream();
  const stderr = collectStream();
  const cli = createCli({
    name: "conform",
    commandsDir: dir,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  // Materialize writes cmd.ts → command path token "cmd".
  const result = await cli.run(c.argv ?? ["cmd"]);
  return { result, stdout: stdout.text(), stderr: stderr.text() };
}

async function runMcpCase(c: FixtureCase) {
  const dir = materializeCommand(c.module);
  const tools = await listMcpTools({ name: "conform", commandsDir: dir });
  const tool = tools.find((t) => t.name === "cmd");
  if (!tool) throw new Error(`expected tool cmd, got ${tools.map((t) => t.name)}`);
  try {
    const result = await invokeMcpTool(tool, c.mcpArgs ?? {}, {
      cwd: dir,
      env: process.env,
      scoped: true,
    });
    return { tool, result, error: null as Error | null };
  } catch (err) {
    return { tool, result: null, error: err as Error };
  }
}

const files = loadFixtureFiles();

describe("spec conformance fixtures", () => {
  it("discovers fixture files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const { file, doc } of files) {
    describe(file, () => {
      for (const c of doc.cases) {
        const title = `${c.id} (${c.status})`;
        if (c.status === "pending") {
          it.skip(title, () => {});
          continue;
        }

        it(title, async () => {
          if (c.transport === "cli") {
            const { result, stdout, stderr } = await runCliCase(c);
            if (c.expect.exitCode !== undefined) {
              expect(result.exitCode).toBe(c.expect.exitCode);
            }
            if (c.expect.stderrMessageIncludes) {
              expect(stderr).toContain(c.expect.stderrMessageIncludes);
            }
            if (c.expect.stdoutJson !== undefined) {
              expect(JSON.parse(stdout)).toEqual(c.expect.stdoutJson);
            }
            return;
          }

          const { tool, result, error } = await runMcpCase(c);
          if (c.expect.isError) {
            expect(error).toBeTruthy();
            if (c.expect.errorMessageIncludes) {
              expect(error!.message).toContain(c.expect.errorMessageIncludes);
            }
            if (c.expect.structuredContentAbsent) {
              expect(result?.structuredContent).toBeUndefined();
            }
          } else {
            expect(error).toBeNull();
            expect(result).toBeTruthy();
            if (c.expect.structuredContent !== undefined) {
              expect(result!.structuredContent).toEqual(c.expect.structuredContent);
            }
          }

          if (c.expect.mcpOutputSchema !== undefined) {
            expect(normalizeSchema(tool.outputSchema)).toEqual(
              normalizeSchema(c.expect.mcpOutputSchema),
            );
            // Cross-check helper matches listed tool schema.
            if (c.module.output) {
              const trueSchema = toOutputJsonSchema(
                zodFromJsonSchema(c.module.output),
              );
              expect(normalizeSchema(projectMcpOutputSchema(trueSchema))).toEqual(
                normalizeSchema(c.expect.mcpOutputSchema),
              );
            }
          }

          if (c.expect.manifestOutputSchema !== undefined && c.module.output) {
            const trueSchema = toOutputJsonSchema(
              zodFromJsonSchema(c.module.output),
            );
            expect(normalizeSchema(trueSchema)).toEqual(
              normalizeSchema(c.expect.manifestOutputSchema),
            );
          }
        });
      }
    });
  }
});
