import { Action, ActionPanel, Icon, List } from "@raycast/api";
import type { ReactElement } from "react";
import { useState } from "react";
import { displayPath, paramCompleteFrom, type Tree } from "../lib/model";
import { useChoices } from "./useChoices";

/**
 * Pick a value for path param `name`: choices from its `completeFrom`
 * source when one is declared, or whatever is typed.
 */
export function ParamPicker(props: {
  tree: Tree;
  template: string[];
  params: Record<string, string>;
  name: string;
  next: (value: string) => ReactElement;
}) {
  const { tree, template, params, name, next } = props;
  const cf = paramCompleteFrom(tree, template, name);
  const { data: choices = [], isLoading, error, revalidate } = useChoices(tree, cf, params);
  const [search, setSearch] = useState("");
  const typed = search.trim();
  const title = [tree.name, displayPath(template, params)].join(" ");

  return (
    <List
      navigationTitle={title}
      isLoading={isLoading}
      filtering
      onSearchTextChange={setSearch}
      searchBarPlaceholder={cf ? `${name} (from ${cf.cmd})` : `Type ${name}`}
    >
      {typed && !choices.some((c) => c.value === typed) && (
        <List.Item
          title={typed}
          subtitle={`use as ${name}`}
          icon={Icon.Pencil}
          actions={
            <ActionPanel>
              <Action.Push title={`Use as ${name}`} target={next(typed)} />
            </ActionPanel>
          }
        />
      )}
      {error && <List.Item title={`${cf?.cmd} failed`} subtitle={error.message} icon={Icon.Warning} />}
      {choices.map((c) => (
        <List.Item
          key={c.value}
          title={c.label ?? c.value}
          subtitle={c.sub ?? (c.label ? c.value : undefined)}
          icon={Icon.Dot}
          keywords={[c.value]}
          actions={
            <ActionPanel>
              <Action.Push title="Select" icon={Icon.ArrowRight} target={next(c.value)} />
              <Action.CopyToClipboard content={c.value} />
              <Action title="Reload Choices" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={revalidate} />
            </ActionPanel>
          }
        />
      ))}
      {!cf && !typed && <List.EmptyView icon={Icon.Pencil} title={`Type a value for ‹${name}›`} />}
    </List>
  );
}
