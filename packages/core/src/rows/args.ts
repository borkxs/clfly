import { positionalNames, projectPositionals } from "../schema/project-positionals.js";
import { projectFlags } from "../schema/to-json-schema.js";
import type { Accepts, CommandModule, FlagInfo, ManifestRoute, PositionalInfo, RowsMeta } from "../types.js";
import { applyAcceptsExport, readRows, type RowTree } from "./index.js";

/**
 * A command module's flags and positionals with `accepts`/`where` applied, the
 * same projection `buildManifest` does. Used to type-check `@<ref>#<n>` binds
 * and to describe a tree's own routes for acceptor lookup.
 */
export function moduleSurface(
  mod: Pick<CommandModule, "args" | "positionals" | "accepts">,
  pathParamNames: string[],
  where: string,
): { flags: FlagInfo[]; positionals: PositionalInfo[] } {
  const positionals = projectPositionals({ pathParamNames, args: mod.args, positionals: mod.positionals });
  const excluded = positionalNames(positionals);
  const flags = (mod.args ? projectFlags(mod.args) : []).filter((f) => !excluded.has(f.name));
  applyAcceptsExport(mod.accepts, flags, positionals, where);
  return { flags, positionals };
}

/** `arg → { accepts, where }` lookup over a projected surface. */
export function acceptsLookup(surface: {
  flags: FlagInfo[];
  positionals: PositionalInfo[];
}): (arg: string) => Accepts | undefined {
  return (arg) => {
    const info = surface.positionals.find((p) => p.name === arg) ?? surface.flags.find((f) => f.name === arg);
    if (!info?.accepts) return undefined;
    return { accepts: info.accepts, ...(info.where ? { where: info.where } : {}) };
  };
}

/** A module's validated `meta.rows`, or undefined. */
export function moduleRows(mod: Pick<CommandModule, "meta">, where: string): RowsMeta | undefined {
  return readRows(mod.meta?.rows, where);
}

/**
 * Every arg, in any tree, that takes rows of `type` (one entry per arg, not
 * per row). `where` is passed through so an agent knows which rows fit.
 */
export function acceptorsOfType(
  trees: RowTree[],
  type: string,
): Array<{ tree: string; route: string[]; arg: string; where?: Accepts["where"] }> {
  const out: Array<{ tree: string; route: string[]; arg: string; where?: Accepts["where"] }> = [];
  for (const tree of trees) {
    for (const route of tree.routes) {
      for (const info of [...route.positionals, ...route.flags]) {
        if (info.accepts !== type) continue;
        out.push({ tree: tree.name, route: route.path, arg: info.name, ...(info.where ? { where: info.where } : {}) });
      }
    }
  }
  return out;
}

export type RowRoute = Pick<ManifestRoute, "path" | "meta" | "flags" | "positionals">;
