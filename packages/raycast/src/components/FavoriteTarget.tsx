import { Detail } from "@raycast/api";
import type { Favorite } from "../lib/favorites";
import { samePath, type Tree } from "../lib/model";
import { openRoute } from "./navigate";
import { ResultView } from "./ResultView";

/** Resolve a pinned command against the current manifests, then run it or open its form. */
export function FavoriteTarget(props: { favorite: Omit<Favorite, "id">; trees?: Tree[]; mode: "run" | "form"; isLoading?: boolean }) {
  const { favorite, trees, mode } = props;
  const tree = trees?.find((t) => t.name === favorite.tree);
  const route = tree?.routes.find((r) => samePath(r.path, favorite.path));
  if (!tree || !route) {
    if (!trees || props.isLoading) return <Detail isLoading markdown={`Loading ${favorite.title}…`} />;
    return <Detail markdown={`## Not found\n\n\`${favorite.title}\` is no longer in the linked trees. Remove the favorite or relink the tree.`} />;
  }
  if (mode === "form") return openRoute(tree, route, favorite.params, favorite.values);
  return <ResultView tree={tree} route={route} params={favorite.params} values={favorite.values} />;
}
