import { createRequire } from "node:module";
import type { ValidatorKind } from "./detect.js";

export function renderTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        // The bin runs under Node's type stripping (@clfly/core/launch): keep imports and
        // syntax erasable so typecheck fails before the bin does.
        verbatimModuleSyntax: true,
        erasableSyntaxOnly: true,
        skipLibCheck: true,
        noEmit: true,
        types: ["node"],
      },
      include: ["bin/**/*.ts", "commands/**/*.ts"],
    },
    null,
    2,
  )}\n`;
}

export function renderReadme(cliName: string): string {
  return `# ${cliName}

Scaffolded with [clfly](https://github.com/borkxs/clfly).

\`\`\`bash
node bin/${cliName}.mjs --help
node bin/${cliName}.mjs hello --name world
node bin/${cliName}.mjs mcp serve
\`\`\`

Add commands with \`clfly add user/:id/report\`.
`;
}

/** Whether the installed @clfly/core ships the `launch` export (published builds do not). */
export function coreHasLaunch(): boolean {
  try {
    createRequire(import.meta.url).resolve("@clfly/core/launch");
    return true;
  } catch {
    return false;
  }
}

/**
 * npm bin. `@clfly/core/launch` runs the TypeScript entry with Node's type stripping on
 * Node >= 22.18 (prebuilt core when fresh) and registers tsx on older Node. A core without
 * that export gets the tsx launcher, which Node 20 can run.
 */
export function renderBinLauncher(cliName: string, launch: boolean = coreHasLaunch()): string {
  if (!launch) {
    return `#!/usr/bin/env node
import { register } from "tsx/esm/api";

register();
await import(new URL("./${cliName}.ts", import.meta.url).href);
`;
  }
  return `#!/usr/bin/env node
import { launch } from "@clfly/core/launch";

await launch(new URL("./${cliName}.ts", import.meta.url));
`;
}

export function renderBin(cliName: string): string {
  return `import { fileURLToPath } from "node:url";
import { createCli } from "@clfly/core";

const cli = createCli({
  name: ${JSON.stringify(cliName)},
  commandsDir: new URL("../commands", import.meta.url),
  packageJsonPath: fileURLToPath(new URL("../package.json", import.meta.url)),
});

const result = await cli.run(process.argv.slice(2));
process.exitCode = result.exitCode;
`;
}

export function renderIndex(cliName: string): string {
  return `export const meta = {
  description: "${cliName} — run a subcommand, or pass --help",
};

export default async function (
  _opts: unknown,
  ctx: { stdout: { write: (s: string) => void } },
) {
  ctx.stdout.write(
    "${cliName}: pass a command (see --help), or try \\"${cliName} hello\\".\\n",
  );
}
`;
}

export function renderHello(validator: ValidatorKind): string {
  switch (validator) {
    case "valibot":
      return `import * as v from "valibot";

export const meta = {
  description: "Say hello",
};

export const args = v.object({
  name: v.pipe(
    v.optional(v.string(), "world"),
    v.description("Who to greet"),
  ),
  mood: v.pipe(
    v.optional(v.picklist(["cheerful", "terse"] as const), "cheerful"),
    v.description("Greeting style"),
  ),
});

export default async function (
  opts: v.InferOutput<typeof args>,
  ctx: { json: boolean; stdout: { write: (s: string) => void } },
) {
  const msg =
    opts.mood === "terse"
      ? \`hi \${opts.name}\`
      : \`Hello, \${opts.name}!\`;
  if (ctx.json) return { message: msg };
  ctx.stdout.write(msg + "\\n");
}
`;
    case "arktype":
      return `import { type } from "arktype";

export const meta = {
  description: "Say hello",
};

export const args = type({
  "name?": "string",
  "mood?": "'cheerful' | 'terse'",
});

export default async function (
  opts: typeof args.infer,
  ctx: { json: boolean; stdout: { write: (s: string) => void } },
) {
  const name = opts.name ?? "world";
  const mood = opts.mood ?? "cheerful";
  const msg = mood === "terse" ? \`hi \${name}\` : \`Hello, \${name}!\`;
  if (ctx.json) return { message: msg };
  ctx.stdout.write(msg + "\\n");
}
`;
    default:
      return `import { z } from "zod";

export const meta = {
  description: "Say hello",
};

export const args = z.object({
  name: z.string().default("world").describe("Who to greet"),
  mood: z
    .enum(["cheerful", "terse"])
    .default("cheerful")
    .describe("Greeting style"),
});

export default async function (
  opts: z.infer<typeof args>,
  ctx: { json: boolean; stdout: { write: (s: string) => void } },
) {
  const msg =
    opts.mood === "terse"
      ? \`hi \${opts.name}\`
      : \`Hello, \${opts.name}!\`;
  if (ctx.json) return { message: msg };
  ctx.stdout.write(msg + "\\n");
}
`;
  }
}

export function renderCommandStub(opts: {
  description: string;
  validator: ValidatorKind;
  withOutput: boolean;
}): string {
  const outputBlock = opts.withOutput
    ? renderOutputStub(opts.validator)
    : "";

  switch (opts.validator) {
    case "valibot":
      return `import * as v from "valibot";

export const meta = {
  description: ${JSON.stringify(opts.description)},
};

export const args = v.object({
  verbose: v.pipe(
    v.optional(v.boolean(), false),
    v.description("Verbose output"),
  ),
});
${outputBlock}
export default async function (
  opts: v.InferOutput<typeof args>,
  ctx: { json: boolean; stdout: { write: (s: string) => void } },
) {
  const result = { ok: true as const, verbose: opts.verbose };
  if (ctx.json) return result;
  ctx.stdout.write(JSON.stringify(result) + "\\n");
}
`;
    case "arktype":
      return `import { type } from "arktype";

export const meta = {
  description: ${JSON.stringify(opts.description)},
};

export const args = type({
  "verbose?": "boolean",
});
${outputBlock}
export default async function (
  opts: typeof args.infer,
  ctx: { json: boolean; stdout: { write: (s: string) => void } },
) {
  const result = { ok: true as const, verbose: opts.verbose ?? false };
  if (ctx.json) return result;
  ctx.stdout.write(JSON.stringify(result) + "\\n");
}
`;
    default:
      return `import { z } from "zod";

export const meta = {
  description: ${JSON.stringify(opts.description)},
};

export const args = z.object({
  verbose: z.boolean().default(false).describe("Verbose output"),
});
${outputBlock}
export default async function (
  opts: z.infer<typeof args>,
  ctx: { json: boolean; stdout: { write: (s: string) => void } },
) {
  const result = { ok: true as const, verbose: opts.verbose };
  if (ctx.json) return result;
  ctx.stdout.write(JSON.stringify(result) + "\\n");
}
`;
  }
}

function renderOutputStub(validator: ValidatorKind): string {
  switch (validator) {
    case "valibot":
      return `
export const output = v.object({
  ok: v.literal(true),
  verbose: v.boolean(),
});
`;
    case "arktype":
      return `
export const output = type({
  ok: "true",
  verbose: "boolean",
});
`;
    default:
      return `
export const output = z.object({
  ok: z.literal(true),
  verbose: z.boolean(),
});
`;
  }
}
