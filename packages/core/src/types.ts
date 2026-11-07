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
  /**
   * Typed rows: what this command's result rows are and how to make a
   * reference from one, so any arg that `accepts` the type can take it.
   * Additive in formatVersion 1.
   */
  rows?: RowsMeta;
}

/** A scalar a `when`/`where` match compares against (as strings). */
export type RowScalar = string | number | boolean;

/** Field path → wanted value (an array means any of). Every key must match. */
export type RowMatch = Record<string, RowScalar | RowScalar[]>;

/** Producer-side typed rows declaration (route `meta.rows`). */
export interface RowsMeta {
  /** Namespaced row type: `"pm.item"`, `"dash.project"`; a shared one like `"fs.path"` crosses trees. */
  type: string;
  /** Where the rows sit in the JSON output: a field path ending in `[]` (`"[]"`, `"hits[]"`). */
  key: string;
  /**
   * Template for the value an acceptor gets: `{field}` reads the row (dot
   * paths ok), then the producer's own args, then `defaults` (`"{path}/{name}"`).
   */
  ref: string;
  /** Only rows matching this are typed (others offer no actions). */
  when?: RowMatch;
  /** Fallbacks for producer args a `ref` names (`{ path: "/" }` for `pm ls` run without one). */
  defaults?: Record<string, string>;
  /** Row field for a display label when rows are used as choices. */
  label?: string;
  /** Row field for a secondary line. */
  sub?: string;
}

/** Consumer-side: an arg takes rows of type `accepts` (optionally only those matching `where`). */
export interface Accepts {
  accepts: string;
  where?: RowMatch;
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
  /**
   * Per-arg choice sources keyed by arg name. Covers path params and schema
   * libraries that cannot carry `completeFrom` in JSON Schema metadata.
   * Wins over a `completeFrom` keyword on the same property.
   */
  complete?: Record<string, CompleteFrom>;
  /**
   * Per-arg typed-row acceptors keyed by arg name: a row type (`"pm.item"`)
   * or `{ type, where? }`. Wins over an `accepts` keyword on the same property.
   */
  accepts?: Record<string, string | { type: string; where?: RowMatch }>;
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
  complete?: Record<string, CompleteFrom>;
  accepts?: Record<string, string | { type: string; where?: RowMatch }>;
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
  /**
   * Injectable stdin text for tests / embedding. When set (including `""`),
   * process.stdin is not read.
   */
  stdinText?: string;
  /**
   * Injectable TTY flag for tests. Defaults to `process.stdin.isTTY` when
   * `stdinText` is not provided; when `stdinText` is provided, defaults to false.
   */
  stdinIsTTY?: boolean;
}

export interface RunResult {
  exitCode: number;
  /** Present when a command handler returned a value. */
  value?: unknown;
  /** Validated args object passed to the command (CLI path). */
  args?: unknown;
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
  /** Where this flag's choices come from. Additive in formatVersion 1. */
  completeFrom?: CompleteFrom;
  /** Row type this flag takes (see {@link RowsMeta}). Additive in formatVersion 1. */
  accepts?: string;
  /** Only rows matching this. */
  where?: RowMatch;
}

/**
 * Declares that an arg's choices are the output of another command in the
 * same tree. Consumers (launchers, phone UIs, shell completions) run
 * `cmd` with `--json` and pick `field` out of the result.
 * Additive in formatVersion 1 — see docs/manifest.md.
 */
export interface CompleteFrom {
  /** Command path in the same tree, space-separated (`"pm search"` or `"search"`; a leading tree name is optional). */
  cmd: string;
  /**
   * Args passed to `cmd`, as flags (`{ limit: 20 }` → `--limit 20`).
   * A string `"$name"` stands for the current value of arg `name` on the
   * command being completed.
   */
  args?: Record<string, string | number | boolean>;
  /** Path to the choice value: dot segments, `[]` maps over an array (`"hits[].infoHash"`, `"rows[].name"`, `"[]"`). */
  field: string;
  /** Path to a display label, relative to the innermost array element `field` mapped over (the output root when `field` has no `[]`). */
  label?: string;
  /** Path to a secondary line, relative to the same element as `label`. */
  sub?: string;
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
  /** Where this positional's choices come from. Additive in formatVersion 1. */
  completeFrom?: CompleteFrom;
  /** Row type this positional takes (see {@link RowsMeta}). Additive in formatVersion 1. */
  accepts?: string;
  /** Only rows matching this. */
  where?: RowMatch;
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
