import type { AnySchema, CommandModule, DefineCommandInput } from "./types.js";

/**
 * Optional ergonomic wrapper that links `args` output type to `run`.
 * Plain exports (`export const args`, `export default`) remain the canonical form.
 */
export function defineCommand<TSchema extends AnySchema>(
  input: DefineCommandInput<TSchema>,
): CommandModule<import("@standard-schema/spec").StandardSchemaV1.InferOutput<TSchema>> {
  return {
    meta: input.meta,
    args: input.args,
    positionals: input.positionals,
    default: input.run,
  };
}
