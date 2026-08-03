/** Integer stamp on codegen'd manifests. Bumps with @clfly/core major (or an explicit breaking manifest change). */
export const MANIFEST_FORMAT_VERSION = 1;

/**
 * Compiled route manifest. Loader must hard-fail on formatVersion mismatch.
 * `load` thunks are present at runtime; codegen writes them as `() => import(...)`.
 */
export interface Manifest {
  formatVersion: number;
  /** Major version of @clfly/core that wrote this manifest — used in mismatch errors. */
  coreMajor: number;
  routes: ManifestRoute[];
}

export interface ManifestRoute {
  /** Path segments; dynamic segments are stored as `":name"`. */
  path: string[];
  /** Lazy import thunk — emitted by `clfly build`. */
  load: () => Promise<unknown>;
  meta?: Meta;
  /**
   * Serializable flag projection of `args` for completions / help without loading
   * the module. Excludes keys that are positionals (path params / `positionals` export).
   */
  flags: FlagInfo[];
  /**
   * Positional args distinct from flags: `[segment]` path params and the optional
   * `positionals` export. Additive in formatVersion 1 — see docs/manifest.md.
   */
  positionals: PositionalInfo[];
  /** JSON Schema projection of `args` (plus path params merged at MCP serve time). */
  inputSchema?: Record<string, unknown>;
  /**
   * JSON Schema projection of an optional `output` export.
   * Absent means the return value is untyped JSON everywhere.
   * Additive in formatVersion 1.
   */
  outputSchema?: Record<string, unknown>;
  /** Import specifier written into the generated file (relative to the manifest). */
  importPath?: string;
}

export interface Meta {
  description?: string;
  /**
   * Marks the command as deprecated. `true` or a reason string.
   * Projects into help text and JSON Schema `"deprecated": true`.
   */
  deprecated?: boolean | string;
  /**
   * Marks the command as CLI-only (body does its own TTY interaction).
   * Excluded from MCP tools and OpenAPI export; noted in help.
   */
  interactive?: boolean;
  /**
   * Hint: command only reads data (no state changes).
   * Projects to MCP `annotations.readOnlyHint`.
   */
  readOnly?: boolean;
  /**
   * Hint: command may destroy or irreversibly change state.
   * Projects to MCP `annotations.destructiveHint`.
   */
  destructive?: boolean;
  /**
   * Hint: repeated identical calls have no additional effect.
   * Projects to MCP `annotations.idempotentHint`.
   */
  idempotent?: boolean;
}

export interface Context {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  commandPath: string[];
  meta: Meta;
  /** True when the global `--json` flag was passed. */
  json: boolean;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  /**
   * When true (MCP `--root`), filesystem access via {@link resolvePath} is
   * jailed under `cwd`. CLI mode is unscoped — absolute paths are allowed.
   */
  scoped: boolean;
  /**
   * Resolve a user-supplied path relative to `cwd`.
   * Under MCP (`scoped`), rejects escapes outside the root.
   */
  resolvePath: (userPath: string) => string;
}

/**
 * Anything implementing Standard Schema (+ ideally Standard JSON Schema).
 * Zod 4 is the documented first-class path; Valibot/ArkType work via the same contract.
 */
export type AnySchema = import("@standard-schema/spec").StandardSchemaV1<
  unknown,
  unknown
> & {
  readonly "~standard": import("@standard-schema/spec").StandardSchemaV1.Props<
    unknown,
    unknown
  > & {
    readonly jsonSchema?: {
      input: (params?: { target?: string }) => Record<string, unknown>;
      output: (params?: { target?: string }) => Record<string, unknown>;
    };
  };
};

export interface CommandModule<TArgs = unknown, TOutput = unknown> {
  meta?: Meta;
  args?: AnySchema;
  /** Extra positionals beyond `[segment]` directory params. */
  positionals?: AnySchema;
  /**
   * Optional schema for the command's return value.
   * When present: always validated on `--json` and MCP; projects to
   * manifest `outputSchema` and MCP `outputSchema` / structured content.
   */
  output?: AnySchema;
  default: (opts: TArgs, ctx: Context) => TOutput | Promise<TOutput>;
}

export interface DefineCommandInput<
  TSchema extends AnySchema,
  TOutputSchema extends AnySchema | undefined = undefined,
> {
  meta?: Meta;
  args: TSchema;
  positionals?: AnySchema;
  output?: TOutputSchema;
  run: (
    opts: import("@standard-schema/spec").StandardSchemaV1.InferOutput<TSchema>,
    ctx: Context,
  ) => unknown | Promise<unknown>;
}

export interface CreateCliOptions {
  name: string;
  /** Absolute path or file URL to the commands directory (dev-mode scan). */
  commandsDir?: string | URL;
  /**
   * Prebuilt manifest (prod). Takes precedence over live scan.
   * Hard-fails if `formatVersion` mismatches this runtime.
   */
  manifest?: Manifest;
  /** Override version string. Defaults to nearest package.json `version`. */
  version?: string;
  /** Path to package.json used for `--version` (default: walk up from cwd / commandsDir). */
  packageJsonPath?: string;
  cwd?: string;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
}

export interface RunResult {
  exitCode: number;
  /** Present when a command handler returned a value. */
  value?: unknown;
}

export interface FlagInfo {
  name: string;
  type: "boolean" | "string" | "number" | "array" | "unknown";
  description?: string;
  optional: boolean;
  default?: unknown;
  enum?: unknown[];
  alias?: string;
  deprecated?: boolean;
}

/** Where a positional comes from in the command module / route tree. */
export type PositionalSource = "path" | "export";

/**
 * Serializable positional projection — never listed under Options in help.
 * Additive on ManifestRoute in formatVersion 1.
 */
export interface PositionalInfo {
  name: string;
  description?: string;
  /** `path` = `[name]` directory segment; `export` = `positionals` schema export. */
  source: PositionalSource;
  /** When true, synopsis uses `[name]`; otherwise `<name>`. */
  optional: boolean;
  /** Variadic rest — synopsis uses `name...`. */
  variadic?: boolean;
  /**
   * When true, `--name` is still accepted at parse time (same key present on `args`).
   * Help renders `(also --name)`.
   */
  alsoFlag?: boolean;
}

export interface RouteSegment {
  type: "static" | "dynamic";
  name: string;
}

export interface RouteNode {
  segment: RouteSegment | null;
  /** Child static/dynamic segments keyed by name (dynamic keyed as `:${name}`). */
  children: Map<string, RouteNode>;
  /** Leaf command module path, if this node is executable (dev scan). */
  commandFile?: string;
  /** Lazy loader from a codegen'd manifest (prod). */
  load?: () => Promise<CommandModule>;
  /** True when this node is an `index` command for its directory. */
  isIndex?: boolean;
  /** Baked meta from manifest (optional; module meta wins when loaded). */
  manifestMeta?: Meta;
  /** Baked flags from manifest for help/completions before load. */
  manifestFlags?: FlagInfo[];
  /** Baked positionals from manifest for help before load. */
  manifestPositionals?: PositionalInfo[];
}

export interface ResolvedRoute {
  node: RouteNode;
  commandPath: string[];
  /** Values captured from `[param]` segments, in walk order. */
  pathParams: Record<string, string>;
  /** Remaining argv tokens after the command path. */
  rest: string[];
}

export type CompletionShell = "bash" | "zsh" | "fish";
