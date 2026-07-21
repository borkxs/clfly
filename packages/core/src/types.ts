import type { StandardSchemaV1 } from "@standard-schema/spec";

/** Integer stamp on codegen'd manifests. Bumps with @clfly/core major (or an explicit breaking manifest change). */
export const MANIFEST_FORMAT_VERSION = 1;

/**
 * Compiled route manifest (M2). Spec'd in M1 so the loader contract is stable
 * before codegen lands. Loader must hard-fail on formatVersion mismatch.
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
  load: () => Promise<CommandModule>;
}

export interface Meta {
  description?: string;
  /**
   * Marks the command as deprecated. `true` or a reason string.
   * Projects into help text and JSON Schema `"deprecated": true`.
   */
  deprecated?: boolean | string;
}

export interface Context {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  commandPath: string[];
  meta: Meta;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

/**
 * Anything implementing Standard Schema (+ ideally Standard JSON Schema).
 * Zod 4 is the documented first-class path; Valibot/ArkType work via the same contract.
 */
export type AnySchema = StandardSchemaV1<unknown, unknown> & {
  readonly "~standard": StandardSchemaV1.Props<unknown, unknown> & {
    readonly jsonSchema?: {
      input: (params?: { target?: string }) => Record<string, unknown>;
      output: (params?: { target?: string }) => Record<string, unknown>;
    };
  };
};

export interface CommandModule<TArgs = unknown> {
  meta?: Meta;
  args?: AnySchema;
  /** Extra positionals beyond `[segment]` directory params. */
  positionals?: AnySchema;
  default: (opts: TArgs, ctx: Context) => unknown | Promise<unknown>;
}

export interface DefineCommandInput<TSchema extends AnySchema> {
  meta?: Meta;
  args: TSchema;
  positionals?: AnySchema;
  run: (
    opts: StandardSchemaV1.InferOutput<TSchema>,
    ctx: Context,
  ) => unknown | Promise<unknown>;
}

export interface CreateCliOptions {
  name: string;
  /** Absolute path or file URL to the commands directory. */
  commandsDir: string | URL;
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

export interface RouteSegment {
  type: "static" | "dynamic";
  name: string;
}

export interface RouteNode {
  segment: RouteSegment | null;
  /** Child static/dynamic segments keyed by name (dynamic keyed as `:${name}`). */
  children: Map<string, RouteNode>;
  /** Leaf command module path, if this node is executable. */
  commandFile?: string;
  /** True when this node is an `index` command for its directory. */
  isIndex?: boolean;
}

export interface ResolvedRoute {
  node: RouteNode;
  commandPath: string[];
  /** Values captured from `[param]` segments, in walk order. */
  pathParams: Record<string, string>;
  /** Remaining argv tokens after the command path. */
  rest: string[];
}
