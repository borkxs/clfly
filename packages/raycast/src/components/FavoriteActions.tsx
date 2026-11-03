import { Action, Icon, showToast, Toast } from "@raycast/api";
import { createDeeplink } from "@raycast/utils";
import { addFavorite, type Favorite } from "../lib/favorites";
import { displayPath, type FormValues, type Route, type Tree } from "../lib/model";

export function favoriteTitle(tree: Tree, route: Route, params: Record<string, string>, values: FormValues): string {
  const shown = Object.entries(values)
    .filter(([, v]) => v !== "" && v !== false)
    .map(([k, v]) => (v === true ? `--${k}` : `${k}=${v}`));
  return [tree.name, displayPath(route.path, params), ...shown].join(" ");
}

/** Deeplink to the `run` command; a quicklink of it is a root-search item that can take a hotkey. */
export function favoriteDeeplink(fav: Omit<Favorite, "id">): string {
  return createDeeplink({ command: "run", context: { favorite: fav } });
}

export function FavoriteActions(props: { tree: Tree; route: Route; params: Record<string, string>; values: FormValues }) {
  const { tree, route, params, values } = props;
  const fav = { title: favoriteTitle(tree, route, params, values), tree: tree.name, path: route.path, params, values };
  return (
    <>
      <Action
        title="Pin to Favorites"
        icon={Icon.Star}
        shortcut={{ modifiers: ["cmd"], key: "p" }}
        onAction={async () => {
          await addFavorite(fav);
          await showToast({ style: Toast.Style.Success, title: "Pinned", message: fav.title });
        }}
      />
      <Action.CreateQuicklink
        title="Create Quicklink (Assign a Hotkey)"
        icon={Icon.Link}
        shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
        quicklink={{ name: fav.title, link: favoriteDeeplink(fav) }}
      />
    </>
  );
}
