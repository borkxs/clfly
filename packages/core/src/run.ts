import type {
  CommandModule,
  CreateCliOptions,
  FlagInfo,
  PositionalInfo,
  ResolvedRoute,
  RouteNode,
  RunResult,
} from "./types.js";
import { ClflyError, ValidationError } from "./errors.js";
import {
  listCommandFiles,
  loadAndValidateCommand,
  scanCommandsDir,
} from "./router/scan.js";
import { listSubcommandsDetailed, resolveRoute } from "./router/resolve.js";
import {
  mapToArgs,
  tokenize,
  wantsHelp,
  wantsVersion,
} from "./parse/tokenize.js";
import { nearestMatch } from "./parse/suggest.js";
import { projectFlags, toJsonSchema, validateSchema } from "./schema/to-json-schema.js";
import {
  parseFlagAllowlist,
  positionalNames,
  projectPositionals,
} from "./schema/project-positionals.js";
import { renderHelp, renderHelpExcerpt } from "./help/render.js";
import {
  fileUrlToPath,
  resolvePackageVersion,
} from "./version.js";
import { treeFromManifest } from "./manifest/load.js";
import { writeJsonError, writeJsonResult } from "./json/output.js";
import {
  isMcpArgv,
  isMcpServeArgv,
  mcpOptionsFromCli,
  parseMcpServeFlags,
  validateOutput,
} from "./mcp/project.js";
import { assertUniqueToolNames } from "./mcp/tool-names.js";
import { assignRestPositionals } from "./parse/rest-positionals.js";
import { createContext } from "./context.js";
import {
  createSessionStore,
  DEFAULT_SPOOL_THRESHOLD,
  resolveSessionId,
  resolveThreshold,
} from "./session/index.js";
import {
  assembleInput,
  rewriteBindSentinels,
  resolveBindField,
} from "./stdin/assemble.js";
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

  if (tree.children.has("mcp")) {
    throw new ClflyError(
      'Command "mcp" is reserved for the MCP transport (`mcp serve`). Rename your commands/mcp path.',
    );
  }
  if (tree.children.has("sessions")) {
    throw new ClflyError(
      'Command "sessions" is reserved for the session store (`sessions list|clean`). Rename your commands/sessions path.',
    );
  }

  assertUniqueToolNames(
    listCommandFiles(tree).map((e) => ({
      path: e.path.map((p) => {
        const m = /^\[([^\]]+)\]$/.exec(p);
        return m?.[1] ? `:${m[1]}` : p;
      }),
      file: e.file,
    })),
  );

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
      const spool = wantsSpool(argv);
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
          spool,
          cliOptions: options,
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
  spool: boolean;
  cliOptions: CreateCliOptions;
}): Promise<RunResult> {
  if (wantsVersion(ctx.argv)) {
    if (ctx.json) {
      writeJsonResult(ctx.stdout, { version: ctx.version });
    } else {
      ctx.stdout.write(`${ctx.version}\n`);
    }
    return { exitCode: 0 };
  }

  // Framework-owned MCP transport — before FS routing.
  if (isMcpServeArgv(ctx.argv)) {
    const flags = parseMcpServeFlags(ctx.argv);
    if (flags.help || wantsHelp(ctx.argv)) {
      ctx.stdout.write(
        `Usage: ${ctx.name} mcp serve [--root <dir>]\n\n` +
          `Expose every command as an MCP tool over stdio.\n` +
          `Tool names come from the command path; inputSchema from the args JSON Schema.\n` +
          `Large results spool under .clfly/sessions/ (see docs/spec/session-store.md).\n` +
          `\nOptions:\n` +
          `  --root <dir>  Filesystem root for tool invocations (default: cwd)\n`,
      );
      return { exitCode: 0 };
    }
    // stderr only — stdout is the MCP JSON-RPC channel.
    const root = flags.root ?? ctx.cwd;
    ctx.stderr.write(
      `${ctx.name} mcp serve listening on stdio (${ctx.version}) root=${root}\n`,
    );
    // Lazy-load SDK only when serving — keeps createCli import graph free of it.
    const { serveMcpStdio } = await import("./mcp/server.js");
    await serveMcpStdio(mcpOptionsFromCli(ctx.cliOptions, { root }));
    return { exitCode: 0 };
  }

  if (isMcpArgv(ctx.argv)) {
    ctx.stdout.write(
      `Usage: ${ctx.name} mcp serve [--root <dir>]\n\n` +
        `Start an MCP server (stdio) projecting this CLI's command tree as tools.\n`,
    );
    return { exitCode: 0 };
  }

  // Framework-owned session store builtins.
  if (isSessionsArgv(ctx.argv)) {
    return runSessionsBuiltin(ctx);
  }

  const pathTokens = stripReserved(ctx.argv);

  // Root help: explicit --help, or bare invocation with no root index command.
  const noRootCommand = !ctx.tree.commandFile && !ctx.tree.load;
  if (
    pathTokens.length === 0 &&
    (wantsHelp(ctx.argv) || noRootCommand)
  ) {
    const help = renderHelp({
      name: ctx.name,
      commandPath: [],
      meta: { description: `${ctx.name} CLI` },
      flags: [],
      positionals: [],
      subcommands: [
        ...(await listSubcommandsDetailed(ctx.tree)),
        {
          name: "mcp",
          description: "MCP transport (mcp serve)",
        },
        {
          name: "sessions",
          description: "Session store (sessions list|clean)",
        },
      ],
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
        positionals: [],
        subcommands: await listSubcommandsDetailed(ctx.tree),
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
  const pathParamNames = Object.keys(resolved.pathParams);
  const { flags, positionals, tokenizeFlags } = projectCommandSurface(
    mod,
    pathParamNames,
    resolved.node,
  );

  if (wantsHelp(ctx.argv)) {
    const help = renderHelp({
      name: ctx.name,
      commandPath: resolved.commandPath,
      meta: mod.meta ?? resolved.node.manifestMeta,
      flags,
      positionals,
      subcommands:
        resolved.node.children.size > 0
          ? await listSubcommandsDetailed(resolved.node)
          : undefined,
    });
    if (ctx.json) {
      writeJsonResult(ctx.stdout, { help });
    } else {
      ctx.stdout.write(help);
    }
    return { exitCode: 0 };
  }

  const rewritten = rewriteBindSentinels(resolved.rest);
  const { flags: parsedFlags, positionals: restTokens } = tokenize(
    rewritten.argv,
    tokenizeFlags,
  );

  assertKnownFlags(parsedFlags, flags, positionals);

  const candidate = mapToArgs({
    pathParams: resolved.pathParams,
    positionals: restTokens,
    flags: parsedFlags,
    pathParamNames,
  });

  const argsInput: Record<string, unknown> = { ...candidate };
  for (const [k, v] of Object.entries(resolved.pathParams)) {
    argsInput[k] = v;
  }
  const { _: _extra, ...stripped } = argsInput;
  const forArgs = assignRestPositionals(
    stripped,
    Array.isArray(_extra) ? _extra.map(String) : [],
    mod.args,
  );

  const bindResolved = resolveBindField(
    forArgs,
    rewritten.flagBindFields,
    rewritten.positionalBindCount,
  );
  if (!bindResolved.ok) {
    throw new ClflyError(bindResolved.message, 2);
  }

  const { text: stdinText, isTTY: stdinIsTTY } = await resolveStdin(
    ctx.cliOptions,
  );

  const declaredKeys = declaredArgKeys(mod, pathParamNames, positionals);
  const assembled = assembleInput({
    argvArgs: forArgs,
    stdinText,
    stdinIsTTY,
    declaredKeys,
    bindField: bindResolved.bindField,
  });
  if (!assembled.ok) {
    throw new ClflyError(assembled.message, 2);
  }

  let opts: unknown = assembled.args;
  if (mod.args) {
    const validated = await validateSchema(mod.args, assembled.args);
    if ("issues" in validated) {
      const excerpt = renderHelpExcerpt({
        name: ctx.name,
        commandPath: resolved.commandPath,
        meta: mod.meta,
        flags,
        positionals,
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

  const result = await mod.default(
    opts,
    createContext({
      argv: ctx.argv,
      cwd: ctx.cwd,
      env: ctx.env,
      commandPath: resolved.commandPath,
      meta: mod.meta ?? {},
      json: ctx.json,
      stdout: ctx.stdout,
      stderr: ctx.stderr,
      scoped: false,
    }),
  );

  // Validate return values when `output` is exported and the consumer is
  // machine-facing (`--json`; MCP validates in invokeMcpTool).
  const value =
    (ctx.json || ctx.spool) && mod.output
      ? await validateOutput(mod, result)
      : result;

  if (ctx.spool && value !== undefined) {
    const threshold = resolveThreshold(
      ctx.env,
      undefined,
      DEFAULT_SPOOL_THRESHOLD,
    );
    const store = createSessionStore({ root: ctx.cwd, threshold });
    const sessionId = resolveSessionId(ctx.env);
    const spooled = store.spool({
      sessionId,
      command: resolved.commandPath
        .map((p) => (p.startsWith("<") ? p.slice(1, -1) : p))
        .join("_") || "root",
      argv: ctx.argv,
      value,
      schemaRef: mod.output ? "output" : undefined,
    });

    if (ctx.json) {
      if (store.exceedsThreshold(value)) {
        writeJsonResult(ctx.stdout, spooled.envelope);
      } else {
        writeJsonResult(ctx.stdout, value);
      }
    } else {
      // Opt-in spool without --json: print absolute path for redirect/bind.
      ctx.stdout.write(`${spooled.path}\n`);
    }
    return { exitCode: 0, value, args: opts };
  }

  if (ctx.json && value !== undefined) {
    writeJsonResult(ctx.stdout, value);
  }

  return { exitCode: 0, value, args: opts };
}

function projectCommandSurface(
  mod: CommandModule,
  pathParamNames: string[],
  node: RouteNode,
): {
  flags: FlagInfo[];
  positionals: PositionalInfo[];
  /** Flags taught to the tokenizer, including alsoFlag positionals. */
  tokenizeFlags: FlagInfo[];
} {
  const positionals =
    mod.args != null || mod.positionals != null || pathParamNames.length > 0
      ? projectPositionals({
          pathParamNames,
          args: mod.args,
          positionals: mod.positionals,
        })
      : (node.manifestPositionals ?? []);

  const excluded = positionalNames(positionals);
  const allFromArgs = mod.args != null ? projectFlags(mod.args) : [];
  const flags =
    mod.args != null
      ? allFromArgs.filter((f) => !excluded.has(f.name))
      : (node.manifestFlags ?? []);

  // Tokenizer must still accept `--name` for positionals with alsoFlag.
  const alsoFlagInfos = allFromArgs.filter(
    (f) => excluded.has(f.name) && positionals.some((p) => p.name === f.name && p.alsoFlag),
  );
  const tokenizeFlags =
    mod.args != null
      ? [...flags, ...alsoFlagInfos]
      : [
          ...flags,
          ...positionals
            .filter((p) => p.alsoFlag)
            .map(
              (p): FlagInfo => ({
                name: p.name,
                type: "string",
                optional: p.optional,
                description: p.description,
              }),
            ),
        ];

  return { flags, positionals, tokenizeFlags };
}

function assertKnownFlags(
  parsed: Record<string, unknown>,
  flags: FlagInfo[],
  positionals: PositionalInfo[],
): void {
  const known = parseFlagAllowlist(flags, positionals);
  const candidates = [...known].filter(
    (n) => n !== "h" && n !== "V" && n.length > 1,
  );
  for (const key of Object.keys(parsed)) {
    if (known.has(key)) continue;
    const display = key.length === 1 ? `-${key}` : `--${key}`;
    const suggestion = nearestMatch(key, candidates);
    throw new ClflyError(
      `Unknown option: ${display}` +
        (suggestion ? `\nDid you mean: --${suggestion}?` : "") +
        `\nRun with --help to see available options.`,
      2,
    );
  }
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
      t !== "--json" &&
      t !== "--spool",
  );
}

function declaredArgKeys(
  mod: CommandModule,
  pathParamNames: string[],
  positionals: PositionalInfo[],
): Set<string> {
  const keys = new Set<string>();
  for (const name of pathParamNames) keys.add(name);
  for (const p of positionals) keys.add(p.name);
  if (mod.args) {
    try {
      const json = toJsonSchema(mod.args);
      const props = (json.properties ?? {}) as Record<string, unknown>;
      for (const name of Object.keys(props)) keys.add(name);
    } catch {
      // Schema without JSON Schema projection — fall back to projected flags.
      for (const f of projectFlags(mod.args)) keys.add(f.name);
    }
  }
  return keys;
}

async function resolveStdin(
  options: CreateCliOptions,
): Promise<{ text: string; isTTY: boolean }> {
  if (options.stdinText !== undefined) {
    return {
      text: options.stdinText,
      isTTY: options.stdinIsTTY ?? false,
    };
  }
  if (options.stdinIsTTY !== undefined) {
    if (options.stdinIsTTY) return { text: "", isTTY: true };
    return { text: await readAllStdin(), isTTY: false };
  }
  // Interactive terminal — ignore stdin.
  if (process.stdin.isTTY === true) {
    return { text: "", isTTY: true };
  }
  // Vitest / node:test leave fd 0 open without EOF; don't hang unit tests.
  // Real pipes/redirects are not run under these runners. Conformance injects.
  if (process.env.VITEST != null || process.env.NODE_TEST_CONTEXT != null) {
    return { text: "", isTTY: true };
  }
  // Pipe or file redirect (`isTTY` falsy) — read to EOF.
  return { text: await readAllStdin(), isTTY: false };
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function wantsJson(argv: string[]): boolean {
  return argv.includes("--json");
}

export function wantsSpool(argv: string[]): boolean {
  return argv.includes("--spool");
}

function isSessionsArgv(argv: string[]): boolean {
  const tokens = argv.filter((t) => !t.startsWith("-") && t !== "--");
  return tokens[0] === "sessions";
}

async function runSessionsBuiltin(ctx: {
  name: string;
  argv: string[];
  cwd: string;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
  json: boolean;
}): Promise<RunResult> {
  const tokens = ctx.argv.filter((t) => !t.startsWith("-") && t !== "--");
  const sub = tokens[1] ?? "list";

  if (wantsHelp(ctx.argv) || sub === "help") {
    ctx.stdout.write(
      `Usage: ${ctx.name} sessions [list|clean]\n\n` +
        `Inspect or evict the shared .clfly/sessions/ store.\n` +
        `  list   List sessions (default)\n` +
        `  clean  Run TTL + max-bytes eviction now\n`,
    );
    return { exitCode: 0 };
  }

  if (sub !== "list" && sub !== "clean") {
    throw new ClflyError(
      `Unknown sessions subcommand: ${sub}\n` +
        `Usage: ${ctx.name} sessions [list|clean]`,
      2,
    );
  }

  const threshold = resolveThreshold(
    ctx.env,
    undefined,
    DEFAULT_SPOOL_THRESHOLD,
  );
  const store = createSessionStore({ root: ctx.cwd, threshold });

  if (sub === "clean") {
    const removed = store.evict();
    if (ctx.json) {
      writeJsonResult(ctx.stdout, { removed });
    } else if (removed.length === 0) {
      ctx.stdout.write("No sessions evicted.\n");
    } else {
      for (const id of removed) ctx.stdout.write(`${id}\n`);
    }
    return { exitCode: 0, value: { removed } };
  }

  const sessions = store.listSessions();
  if (ctx.json) {
    writeJsonResult(ctx.stdout, sessions);
  } else if (sessions.length === 0) {
    ctx.stdout.write("No sessions.\n");
  } else {
    for (const s of sessions) {
      ctx.stdout.write(
        `${s.sessionId}  entries=${s.entries}  bytes=${s.bytes}  mtime=${new Date(s.mtimeMs).toISOString()}\n`,
      );
    }
  }
  return { exitCode: 0, value: sessions };
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
