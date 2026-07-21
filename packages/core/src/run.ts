import type {
  CommandModule,
  CreateCliOptions,
  FlagInfo,
  ResolvedRoute,
  RouteNode,
  RunResult,
} from "./types.js";
import { ClflyError, ValidationError } from "./errors.js";
import {
  loadAndValidateCommand,
  scanCommandsDir,
} from "./router/scan.js";
import { listSubcommands, resolveRoute } from "./router/resolve.js";
import {
  mapToArgs,
  tokenize,
  wantsHelp,
  wantsVersion,
} from "./parse/tokenize.js";
import { projectFlags, validateSchema } from "./schema/to-json-schema.js";
import { renderHelp, renderHelpExcerpt } from "./help/render.js";
import { fileUrlToPath, resolvePackageVersion } from "./version.js";

export interface Cli {
  run: (argv?: string[]) => Promise<RunResult>;
  /** Dev-mode scanned tree (exposed for tests). */
  readonly tree: RouteNode;
}

export function createCli(options: CreateCliOptions): Cli {
  const commandsDir = fileUrlToPath(options.commandsDir);
  const tree = scanCommandsDir(commandsDir);
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const version =
    options.version ??
    resolvePackageVersion(options.packageJsonPath ? cwd : commandsDir, options.packageJsonPath);

  return {
    tree,
    async run(argv = process.argv.slice(2)): Promise<RunResult> {
      try {
        return await runCli({
          name: options.name,
          tree,
          commandsDir,
          argv,
          cwd,
          stdout,
          stderr,
          env,
          version,
        });
      } catch (err) {
        if (err instanceof ClflyError) {
          stderr.write(err.message + "\n");
          return { exitCode: err.exitCode };
        }
        throw err;
      }
    },
  };
}

async function runCli(ctx: {
  name: string;
  tree: RouteNode;
  commandsDir: string;
  argv: string[];
  cwd: string;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
  version: string;
}): Promise<RunResult> {
  // Global reserved flags before routing when asked at root with no command path
  if (wantsVersion(ctx.argv)) {
    // Bare version string — script-friendly; no name prefix, no ANSI.
    ctx.stdout.write(`${ctx.version}\n`);
    return { exitCode: 0 };
  }

  const pathTokens = stripReserved(ctx.argv);

  // Root help with no subcommand
  if (wantsHelp(ctx.argv) && pathTokens.length === 0) {
    const help = renderHelp({
      name: ctx.name,
      commandPath: [],
      meta: { description: `${ctx.name} CLI` },
      flags: [],
      pathParamNames: [],
      subcommands: listSubcommands(ctx.tree),
    });
    ctx.stdout.write(help);
    return { exitCode: 0 };
  }

  let resolved: ResolvedRoute;
  try {
    resolved = resolveRoute(ctx.tree, pathTokens);
  } catch (err) {
    if (wantsHelp(ctx.argv)) {
      const help = renderHelp({
        name: ctx.name,
        commandPath: [],
        flags: [],
        pathParamNames: [],
        subcommands: listSubcommands(ctx.tree),
      });
      ctx.stdout.write(help);
      return { exitCode: 0 };
    }
    throw err;
  }

  const file = resolved.node.commandFile!;
  const commandPath = resolved.commandPath.filter((p) => !p.startsWith("<"));
  // For reserved-flag errors, use human path including dynamic labels
  const labelPath = resolved.commandPath.map((p) =>
    p.startsWith("<") ? p.slice(1, -1) : p,
  );

  const mod = await loadAndValidateCommand(file, labelPath);
  const flags = mod.args ? projectFlags(mod.args) : [];
  const pathParamNames = Object.keys(resolved.pathParams);

  if (wantsHelp(ctx.argv)) {
    const help = renderHelp({
      name: ctx.name,
      commandPath: resolved.commandPath,
      meta: mod.meta,
      flags,
      pathParamNames,
      subcommands:
        resolved.node.children.size > 0
          ? listSubcommands(resolved.node)
          : undefined,
    });
    ctx.stdout.write(help);
    return { exitCode: 0 };
  }

  // Tokens after the command path (resolved.rest still includes flags)
  const { flags: parsedFlags, positionals } = tokenize(resolved.rest, flags);

  // Positionals from tokenize are leftover non-flag tokens under the command;
  // path params were already consumed during resolve.
  const candidate = mapToArgs({
    pathParams: resolved.pathParams,
    positionals,
    flags: parsedFlags,
    pathParamNames,
  });

  // Fold path params into the object the command sees
  const argsInput: Record<string, unknown> = { ...candidate };
  for (const [k, v] of Object.entries(resolved.pathParams)) {
    argsInput[k] = v;
  }
  // Don't pass internal `_` unless positionals schema expects it — strip for args validate
  const { _: _extra, ...forArgs } = argsInput;

  let opts: unknown = forArgs;
  if (mod.args) {
    const validated = await validateSchema(mod.args, forArgs);
    if ("issues" in validated) {
      const excerpt = renderHelpExcerpt({
        name: ctx.name,
        commandPath: resolved.commandPath,
        meta: mod.meta,
        flags,
        pathParamNames,
      });
      const issues = validated.issues.map((issue) => ({
        ...issue,
        expected: expectedFromFlags(flags, issue.path),
      }));
      throw new ValidationError(issues, excerpt);
    }
    opts = validated.value;
  }

  // Merge path params into validated opts if schema didn't include them
  if (typeof opts === "object" && opts !== null) {
    opts = { ...resolved.pathParams, ...opts };
  }

  const result = await mod.default(opts, {
    argv: ctx.argv,
    cwd: ctx.cwd,
    env: ctx.env,
    commandPath: resolved.commandPath,
    meta: mod.meta ?? {},
    stdout: ctx.stdout,
    stderr: ctx.stderr,
  });

  return { exitCode: 0, value: result };
}

function stripReserved(argv: string[]): string[] {
  return argv.filter(
    (t) =>
      t !== "--" &&
      t !== "--help" &&
      t !== "-h" &&
      t !== "--version" &&
      t !== "-V",
  );
}

function expectedFromFlags(
  flags: FlagInfo[],
  path: PropertyKey[],
): string | undefined {
  const key = path[0];
  if (typeof key !== "string") return undefined;
  const flag = flags.find((f) => f.name === key);
  if (!flag) return undefined;
  if (flag.enum) return flag.enum.map(String).join(" | ");
  return flag.type;
}

/** Programmatic helper for tests: resolve + load without running. */
export async function resolveCommand(
  tree: RouteNode,
  commandsDir: string,
  tokens: string[],
): Promise<{ resolved: ResolvedRoute; mod: CommandModule }> {
  const resolved = resolveRoute(tree, tokens);
  const labelPath = resolved.commandPath.map((p) =>
    p.startsWith("<") ? p.slice(1, -1) : p,
  );
  const mod = await loadAndValidateCommand(resolved.node.commandFile!, labelPath);
  void commandsDir;
  return { resolved, mod };
}
