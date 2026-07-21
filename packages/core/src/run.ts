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
import {
  fileUrlToPath,
  resolvePackageVersion,
} from "./version.js";
import { treeFromManifest } from "./manifest/load.js";
import { writeJsonError, writeJsonResult } from "./json/output.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Cli {
  run: (argv?: string[]) => Promise<RunResult>;
  /** Resolved route tree (dev scan or manifest). */
  readonly tree: RouteNode;
}

export function createCli(options: CreateCliOptions): Cli {
  if (!options.commandsDir && !options.manifest) {
    throw new ClflyError("createCli requires commandsDir and/or manifest");
  }

  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const coreVersion = readInstalledCoreVersion();

  const commandsDir = options.commandsDir
    ? fileUrlToPath(options.commandsDir)
    : undefined;

  const tree = options.manifest
    ? treeFromManifest(options.manifest, coreVersion)
    : scanCommandsDir(commandsDir!);

  const version =
    options.version ??
    resolvePackageVersion(
      options.packageJsonPath
        ? dirname(options.packageJsonPath)
        : (commandsDir ?? cwd),
      options.packageJsonPath,
    );

  return {
    tree,
    async run(argv = process.argv.slice(2)): Promise<RunResult> {
      const json = wantsJson(argv);
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
          json,
        });
      } catch (err) {
        if (err instanceof ValidationError) {
          if (json) {
            writeJsonError(stderr, "Invalid arguments", err.issues);
          } else {
            stderr.write(err.message + "\n");
          }
          return { exitCode: err.exitCode };
        }
        if (err instanceof ClflyError) {
          if (json) {
            writeJsonError(stderr, err.message);
          } else {
            stderr.write(err.message + "\n");
          }
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
  commandsDir?: string;
  argv: string[];
  cwd: string;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
  version: string;
  json: boolean;
}): Promise<RunResult> {
  if (wantsVersion(ctx.argv)) {
    if (ctx.json) {
      writeJsonResult(ctx.stdout, { version: ctx.version });
    } else {
      ctx.stdout.write(`${ctx.version}\n`);
    }
    return { exitCode: 0 };
  }

  const pathTokens = stripReserved(ctx.argv);

  if (wantsHelp(ctx.argv) && pathTokens.length === 0) {
    const help = renderHelp({
      name: ctx.name,
      commandPath: [],
      meta: { description: `${ctx.name} CLI` },
      flags: [],
      pathParamNames: [],
      subcommands: listSubcommands(ctx.tree),
    });
    if (ctx.json) {
      writeJsonResult(ctx.stdout, { help });
    } else {
      ctx.stdout.write(help);
    }
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

  const labelPath = resolved.commandPath.map((p) =>
    p.startsWith("<") ? p.slice(1, -1) : p,
  );

  const mod = await loadResolvedCommand(resolved, labelPath);
  const flags =
    mod.args != null
      ? projectFlags(mod.args)
      : (resolved.node.manifestFlags ?? []);
  const pathParamNames = Object.keys(resolved.pathParams);

  if (wantsHelp(ctx.argv)) {
    const help = renderHelp({
      name: ctx.name,
      commandPath: resolved.commandPath,
      meta: mod.meta ?? resolved.node.manifestMeta,
      flags,
      pathParamNames,
      subcommands:
        resolved.node.children.size > 0
          ? listSubcommands(resolved.node)
          : undefined,
    });
    if (ctx.json) {
      writeJsonResult(ctx.stdout, { help });
    } else {
      ctx.stdout.write(help);
    }
    return { exitCode: 0 };
  }

  const { flags: parsedFlags, positionals } = tokenize(resolved.rest, flags);

  const candidate = mapToArgs({
    pathParams: resolved.pathParams,
    positionals,
    flags: parsedFlags,
    pathParamNames,
  });

  const argsInput: Record<string, unknown> = { ...candidate };
  for (const [k, v] of Object.entries(resolved.pathParams)) {
    argsInput[k] = v;
  }
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

  if (typeof opts === "object" && opts !== null) {
    opts = { ...resolved.pathParams, ...opts };
  }

  const result = await mod.default(opts, {
    argv: ctx.argv,
    cwd: ctx.cwd,
    env: ctx.env,
    commandPath: resolved.commandPath,
    meta: mod.meta ?? {},
    json: ctx.json,
    stdout: ctx.stdout,
    stderr: ctx.stderr,
  });

  if (ctx.json && result !== undefined) {
    writeJsonResult(ctx.stdout, result);
  }

  return { exitCode: 0, value: result };
}

async function loadResolvedCommand(
  resolved: ResolvedRoute,
  labelPath: string[],
): Promise<CommandModule> {
  if (resolved.node.load) {
    const mod = await resolved.node.load();
    if (mod.args) {
      const { assertSchemaNoReservedFlags } = await import("./schema/reserved.js");
      assertSchemaNoReservedFlags(labelPath, mod.args);
    }
    return mod;
  }
  if (resolved.node.commandFile) {
    return loadAndValidateCommand(resolved.node.commandFile, labelPath);
  }
  throw new ClflyError(`No loader for command ${labelPath.join(" ") || "(root)"}`);
}

function stripReserved(argv: string[]): string[] {
  return argv.filter(
    (t) =>
      t !== "--" &&
      t !== "--help" &&
      t !== "-h" &&
      t !== "--version" &&
      t !== "-V" &&
      t !== "--json",
  );
}

export function wantsJson(argv: string[]): boolean {
  return argv.includes("--json");
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

function readInstalledCoreVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/ or src/
    for (const candidate of [
      join(here, "..", "package.json"),
      join(here, "..", "..", "package.json"),
    ]) {
      try {
        const raw = readFileSync(candidate, "utf8");
        const v = (JSON.parse(raw) as { name?: string; version?: string }).version;
        if (v) return v;
      } catch {
        /* try next */
      }
    }
  } catch {
    /* fallthrough */
  }
  return "0.0.0";
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
  const mod = await loadResolvedCommand(resolved, labelPath);
  void commandsDir;
  return { resolved, mod };
}
