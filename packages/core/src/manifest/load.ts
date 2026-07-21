import type {
  CommandModule,
  FlagInfo,
  Manifest,
  Meta,
  RouteNode,
  RouteSegment,
} from "../types.js";
import { assertManifestCompatible } from "../version.js";
import { ClflyError } from "../errors.js";

/** Build a RouteNode tree from a codegen'd manifest (prod path). */
export function treeFromManifest(
  manifest: Manifest,
  coreVersion: string,
): RouteNode {
  assertManifestCompatible(manifest, coreVersion);

  const root: RouteNode = {
    segment: null,
    children: new Map(),
  };

  for (const route of manifest.routes) {
    let node = root;
    for (const part of route.path) {
      const seg = parseManifestSegment(part);
      const key = seg.type === "dynamic" ? `:${seg.name}` : seg.name;
      let child = node.children.get(key);
      if (!child) {
        child = { segment: seg, children: new Map() };
        node.children.set(key, child);
      }
      node = child;
    }
    node.load = async () => normalizeLoadedModule(await route.load());
    node.manifestMeta = route.meta;
    node.manifestFlags = route.flags;
    if (route.path.length === 0) node.isIndex = true;
  }

  return root;
}

function parseManifestSegment(part: string): RouteSegment {
  if (part.startsWith(":")) {
    return { type: "dynamic", name: part.slice(1) };
  }
  return { type: "static", name: part };
}

function normalizeLoadedModule(mod: unknown): CommandModule {
  const m = mod as CommandModule & { default?: CommandModule["default"] };
  if (typeof m.default !== "function") {
    throw new ClflyError("Manifest route load() did not return a default export function");
  }
  return {
    meta: m.meta,
    args: m.args,
    positionals: m.positionals,
    default: m.default,
  };
}

/** Flatten manifest routes into a completion-friendly index. */
export function completionIndexFromManifest(manifest: Manifest): CompletionCommand[] {
  return manifest.routes.map((r) => ({
    path: r.path.map((p) => (p.startsWith(":") ? `<${p.slice(1)}>` : p)),
    rawPath: r.path,
    description: r.meta?.description,
    deprecated: r.meta?.deprecated,
    flags: r.flags,
  }));
}

export interface CompletionCommand {
  path: string[];
  rawPath: string[];
  description?: string;
  deprecated?: boolean | string;
  flags: FlagInfo[];
  meta?: Meta;
}
