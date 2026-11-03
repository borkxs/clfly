import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useState } from "react";
import { displayPath } from "../lib/model";
import { openRoute, viewAt } from "./navigate";
import { routeIcon } from "./RouteList";
import { useTrees } from "./useTrees";

/** Linked trees; typing also matches every command across them. */
export function TreeList() {
  const { data: trees = [], isLoading, error, revalidate } = useTrees();
  const [search, setSearch] = useState("");
  const reload = <Action title="Reload Trees" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={revalidate} />;

  return (
    <List isLoading={isLoading} filtering onSearchTextChange={setSearch} searchBarPlaceholder="Tree or command…">
      {error && !trees.length && (
        <List.EmptyView icon={Icon.Warning} title="Could not read clfly trees" description={error.message} actions={<ActionPanel>{reload}</ActionPanel>} />
      )}
      <List.Section title="Trees">
        {trees.map((tree) => (
          <List.Item
            key={tree.name}
            title={tree.name}
            subtitle={tree.error ? `error: ${tree.error.split("\n")[0]}` : tree.description}
            icon={tree.error ? Icon.Warning : Icon.Terminal}
            accessories={[{ text: `${tree.routes.length}` }]}
            actions={
              <ActionPanel>
                {!tree.error && <Action.Push title="Open" icon={Icon.ArrowRight} target={viewAt(tree, [], {})} />}
                <Action.ShowInFinder path={tree.root} />
                {reload}
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      {search.trim() && (
        <List.Section title="Commands">
          {trees.flatMap((tree) =>
            tree.routes.map((route) => {
              const title = [tree.name, displayPath(route.path)].filter(Boolean).join(" ");
              return (
                <List.Item
                  key={`${tree.name} ${route.path.join(" ")}`}
                  title={title}
                  subtitle={route.meta?.description}
                  icon={routeIcon(route)}
                  keywords={[tree.name, ...route.path, ...(route.meta?.description?.split(/\W+/) ?? [])]}
                  actions={
                    <ActionPanel>
                      <Action.Push title="Open" icon={Icon.ArrowRight} target={openRoute(tree, route, {})} />
                      {reload}
                    </ActionPanel>
                  }
                />
              );
            }),
          )}
        </List.Section>
      )}
    </List>
  );
}
