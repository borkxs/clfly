import { Detail, Icon, List } from "@raycast/api";
import { viewAt } from "./navigate";
import { useTrees } from "./useTrees";

/** One tree's commands as a top-level Raycast command (generated per tree by scripts/gen-tree-commands.mjs). */
export function TreeRoot({ name }: { name: string }) {
  const { data: trees, isLoading, error } = useTrees();
  const tree = trees?.find((t) => t.name === name);
  if (!tree) {
    if (isLoading) return <List isLoading />;
    const why = error?.message ?? `No linked tree named "${name}". Run \`clfly ls\`, then regenerate with \`npm run gen-trees\`.`;
    return <Detail markdown={`# ${name}\n\n${why}`} />;
  }
  if (tree.error) return <List><List.EmptyView icon={Icon.Warning} title={`${name} failed to load`} description={tree.error} /></List>;
  return viewAt(tree, [], {});
}
