import type { ResolvedRoute, RouteNode } from "../types.js";
import { ClflyError } from "../errors.js";

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
      const suggestion = suggest(root, tokens);
      throw new ClflyError(
        `Unknown command: ${[...commandPath, token].join(" ")}` +
          (suggestion ? `\nDid you mean: ${suggestion}?` : "") +
          `\nRun with --help to see available commands.`,
      );
    }

    break;
  }

  // Prefer deepest command file; fall back to current node's index
  if (!node.commandFile) {
    const suggestion = suggest(root, tokens);
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

function suggest(root: RouteNode, tokens: string[]): string | undefined {
  const names = collectStaticNames(root);
  const needle = tokens.find((t) => !t.startsWith("-"));
  if (!needle) return undefined;
  let best: string | undefined;
  let bestDist = Infinity;
  for (const name of names) {
    const d = levenshtein(needle, name);
    if (d < bestDist && d <= 2) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

function collectStaticNames(node: RouteNode, out: string[] = []): string[] {
  for (const [key, child] of node.children) {
    if (!key.startsWith(":")) out.push(key);
    collectStaticNames(child, out);
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[m]![n]!;
}

/** List top-level / nested subcommand names for help. */
export function listSubcommands(
  node: RouteNode,
): Array<{ name: string; description?: string }> {
  const out: Array<{ name: string; description?: string }> = [];
  for (const [key, child] of node.children) {
    if (key.startsWith(":")) {
      out.push({ name: `<${key.slice(1)}>`, description: undefined });
    } else {
      out.push({ name: key, description: undefined });
    }
    void child;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
