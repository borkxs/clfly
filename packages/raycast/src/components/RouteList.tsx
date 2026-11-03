import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import {
  childrenAt,
  displayPath,
  isDestructive,
  isDynamic,
  paramName,
  routeAt,
  type Route,
  type Tree,
} from "../lib/model";
import { openRoute, segmentTitle, viewAt } from "./navigate";
import { ParamPicker } from "./ParamPicker";

export function routeIcon(route: Route | undefined) {
  if (!route) return Icon.Folder;
  if (isDestructive(route)) return { source: Icon.Trash, tintColor: Color.Red };
  if (route.meta?.interactive) return Icon.Terminal;
  return route.meta?.readOnly ? Icon.Eye : Icon.Play;
}

/** Subcommands one level below `template`; dynamic segments open a picker. */
export function RouteList(props: { tree: Tree; template: string[]; params: Record<string, string> }) {
  const { tree, template, params } = props;
  const self = routeAt(tree, template);
  const children = childrenAt(tree, template);
  const here = [tree.name, displayPath(template, params)].filter(Boolean).join(" ");

  return (
    <List navigationTitle={here} searchBarPlaceholder={`${here} …`}>
      {self && (
        <List.Item
          title={`Run ${here}`}
          subtitle={self.meta?.description}
          icon={routeIcon(self)}
          actions={
            <ActionPanel>
              <Action.Push title="Open" icon={Icon.ArrowRight} target={openRoute(tree, self, params)} />
            </ActionPanel>
          }
        />
      )}
      {children.map((child) => {
        const next = [...template, child.segment];
        const description = child.leaf?.meta?.description;
        const target = isDynamic(child.segment) ? (
          <ParamPicker
            tree={tree}
            template={next}
            params={params}
            name={paramName(child.segment)}
            next={(value) => viewAt(tree, next, { ...params, [paramName(child.segment)]: value })}
          />
        ) : (
          viewAt(tree, next, params)
        );
        return (
          <List.Item
            key={child.segment}
            title={segmentTitle(child.segment)}
            subtitle={description}
            icon={child.hasChildren ? Icon.Folder : routeIcon(child.leaf)}
            accessories={child.hasChildren ? [{ text: `${child.count}` }] : []}
            keywords={description ? description.split(/\W+/) : []}
            actions={
              <ActionPanel>
                <Action.Push title="Open" icon={Icon.ArrowRight} target={target} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
