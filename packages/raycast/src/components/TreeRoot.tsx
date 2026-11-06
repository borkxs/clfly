import { Detail, Icon, List } from "@raycast/api";
import { isDestructive, isLiveSearch, parseTyped } from "../lib/model";
import { LiveSearch } from "./LiveSearch";
import { openRoute, viewAt } from "./navigate";
import { ResultView } from "./ResultView";
import { useTrees } from "./useTrees";

/**
 * One tree as a top-level Raycast command (generated per tree by scripts/gen-tree-commands.mjs).
 * `typed` is the inline argument: `pm` ⇥ `status --all` runs `pm status --all`.
 */
export function TreeRoot({ name, typed }: { name: string; typed?: string }) {
  const { data: trees, isLoading, error } = useTrees();
  const tree = trees?.find((t) => t.name === name);
  if (!tree) {
    if (isLoading) return <List isLoading />;
    const why = error?.message ?? `No linked tree named "${name}". Run \`clfly ls\`, then regenerate with \`npm run gen-trees\`.`;
    return <Detail markdown={`# ${name}\n\n${why}`} />;
  }
  if (tree.error) return <List><List.EmptyView icon={Icon.Warning} title={`${name} failed to load`} description={tree.error} /></List>;
  if (!typed?.trim()) return viewAt(tree, [], {});

  const { template, params, route, values, ready } = parseTyped(tree, typed);
  if (!route) {
    // Words that aren't a command go to the tree's top-level search (`pm nathan for you` → pm search).
    const search = template.length === 0 ? tree.routes.find((r) => r.path.length === 1 && isLiveSearch(r)) : undefined;
    if (search) return <LiveSearch tree={tree} route={search} params={{}} initialQuery={typed.trim()} />;
    return viewAt(tree, template, params);
  }
  const given = Object.keys(values).length > 0;
  if (ready && !isDestructive(route)) return <ResultView tree={tree} route={route} params={params} values={values} />;
  return openRoute(tree, route, params, given ? values : undefined);
}
