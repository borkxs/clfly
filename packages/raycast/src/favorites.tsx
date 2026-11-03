import { Action, ActionPanel, Alert, confirmAlert, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { favoriteDeeplink } from "./components/FavoriteActions";
import { FavoriteTarget } from "./components/FavoriteTarget";
import { useTrees } from "./components/useTrees";
import { loadFavorites, removeFavorite } from "./lib/favorites";

export default function Command() {
  const { data: favorites = [], isLoading, revalidate } = usePromise(loadFavorites);
  const trees = useTrees();

  return (
    <List isLoading={isLoading || trees.isLoading} searchBarPlaceholder="Pinned commands…">
      <List.EmptyView icon={Icon.Star} title="No favorites" description="Pin a command with ⌘P from its form or results." />
      {favorites.map((fav) => {
        const { id: _id, ...rest } = fav;
        return (
          <List.Item
            key={fav.id}
            title={fav.title}
            icon={Icon.Star}
            actions={
              <ActionPanel>
                <Action.Push title="Run" icon={Icon.Play} target={<FavoriteTarget favorite={fav} trees={trees.data} mode="run" />} />
                <Action.Push title="Edit Arguments" icon={Icon.Pencil} shortcut={{ modifiers: ["cmd"], key: "e" }} target={<FavoriteTarget favorite={fav} trees={trees.data} mode="form" />} />
                <Action.CreateQuicklink
                  title="Create Quicklink (Assign a Hotkey)"
                  icon={Icon.Link}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
                  quicklink={{ name: fav.title, link: favoriteDeeplink(rest) }}
                />
                <Action
                  title="Remove"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={async () => {
                    if (await confirmAlert({ title: `Remove ${fav.title}?`, primaryAction: { title: "Remove", style: Alert.ActionStyle.Destructive } })) {
                      await removeFavorite(fav.id);
                      revalidate();
                    }
                  }}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
