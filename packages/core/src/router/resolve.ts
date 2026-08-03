import type { ResolvedRoute, RouteNode } from "../types.js";
import { ClflyError } from "../errors.js";
import { nearestMatch } from "../parse/suggest.js";

/**
 * Walk argv tokens against the route tree.
 * Static segments must match exactly; one dynamic child may consume a token.
 * Stops when a leaf is found and either no more tokens look like subcommands
 * or the current node has a command and the next token is a flag / exhausted.
 */
export function resolveRoute(
  root: RouteNode,
  tokens: string[],
): ResolvedRoute {
  let node = root;
  const commandPath: string[] = [];
  const pathParams: Record<string, string> = {};
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token.startsWith("-")) break;

    const staticChild = node.children.get(token);
    if (staticChild) {
      node = staticChild;
      commandPath.push(token);
      i++;
      continue;
    }

    const dynamicChild = findDynamicChild(node);
    if (dynamicChild?.segment) {
      pathParams[dynamicChild.segment.name] = token;
      node = dynamicChild;
      commandPath.push(`<${dynamicChild.segment.name}>`);
      i++;
      continue;
    }

    // Subcommands exist but token matched none — hard error (no silent
    // fallback to an index/leaf that shares the node).
    if (node.children.size > 0) {
      const suggestion = suggestCommand(root, token);
      throw new ClflyError(
        `Unknown command: ${[...commandPath, token].join(" ")}` +
          (suggestion ? `\nDid you mean: ${suggestion}?` : "") +
          `\nRun with --help to see available commands.`,
      );
    }

    break;
  }

  // Prefer deepest executable node (dev file or manifest load thunk)
  if (!node.commandFile && !node.load) {
    const needle = tokens[i] ?? tokens[tokens.length - 1];
    const suggestion = needle ? suggestCommand(root, needle) : undefined;
    throw new ClflyError(
      `Unknown command: ${tokens.slice(0, i + 1).join(" ") || "(root)"}` +
        (suggestion ? `\nDid you mean: ${suggestion}?` : "") +
        `\nRun with --help to see available commands.`,
    );
  }

  return {
    node,
    commandPath,
    pathParams,
    rest: tokens.slice(i),
  };
}

function findDynamicChild(node: RouteNode): RouteNode | undefined {
  for (const [key, child] of node.children) {
    if (key.startsWith(":")) return child;
  }
  return undefined;
}

function suggestCommand(root: RouteNode, needle: string): string | undefined {
  return nearestMatch(needle, collectStaticNames(root));
}

function collectStaticNames(node: RouteNode, out: string[] = []): string[] {
  for (const [key, child] of node.children) {
    if (!key.startsWith(":")) out.push(key);
    collectStaticNames(child, out);
  }
  return out;
}

/** List child subcommand names for help (sync; manifest meta only). */
export function listSubcommands(
  node: RouteNode,
): Array<{ name: string; description?: string }> {
  const out: Array<{ name: string; description?: string }> = [];
  for (const [key, child] of node.children) {
    if (key.startsWith(":")) {
      out.push({
        name: `<${key.slice(1)}>`,
        description: child.manifestMeta?.description,
      });
    } else {
      out.push({
        name: key,
        description: child.manifestMeta?.description,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Like {@link listSubcommands}, but loads command modules when manifest meta
 * is missing (dev scan). Prefer this on help paths.
 */
export async function listSubcommandsDetailed(
  node: RouteNode,
): Promise<Array<{ name: string; description?: string }>> {
  const out: Array<{ name: string; description?: string }> = [];
  for (const [key, child] of node.children) {
    const name = key.startsWith(":") ? `<${key.slice(1)}>` : key;
    let description = child.manifestMeta?.description;
    if (description === undefined) {
      description = await loadNodeDescription(child);
    }
    out.push({ name, description });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadNodeDescription(
  node: RouteNode,
): Promise<string | undefined> {
  try {
    if (node.load) {
      const mod = await node.load();
      return mod.meta?.description;
    }
    if (node.commandFile) {
      const { loadCommandModule } = await import("./scan.js");
      const mod = await loadCommandModule(node.commandFile);
      return mod.meta?.description;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
