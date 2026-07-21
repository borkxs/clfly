import type { AnySchema, FlagInfo } from "../types.js";
import { ReservedFlagError } from "../errors.js";
import { projectFlags } from "./to-json-schema.js";

/** Framework-owned flags. Commands must not claim these names or aliases. */
export const RESERVED_FLAGS = new Set(["help", "version"]);
export const RESERVED_ALIASES = new Set(["h", "V"]);

export function assertNoReservedFlags(
  commandPath: string[],
  flags: FlagInfo[],
): void {
  for (const flag of flags) {
    if (RESERVED_FLAGS.has(flag.name)) {
      throw new ReservedFlagError(commandPath, flag.name);
    }
    if (flag.alias && RESERVED_ALIASES.has(flag.alias)) {
      throw new ReservedFlagError(commandPath, `-${flag.alias}`);
    }
    if (flag.alias && RESERVED_FLAGS.has(flag.alias)) {
      throw new ReservedFlagError(commandPath, flag.alias);
    }
  }
}

export function assertSchemaNoReservedFlags(
  commandPath: string[],
  schema: AnySchema | undefined,
): void {
  if (!schema) return;
  assertNoReservedFlags(commandPath, projectFlags(schema));
}
