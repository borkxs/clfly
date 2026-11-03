import type { ReactElement } from "react";
import { childrenAt, isLiveSearch, missingParams, paramName, routeAt, type FormValues, type Route, type Tree } from "../lib/model";
import { CommandForm } from "./CommandForm";
import { LiveSearch } from "./LiveSearch";
import { ParamPicker } from "./ParamPicker";
import { RouteList } from "./RouteList";

/** Where drilling to `template` lands: a list of what is below, or the command itself. */
export function viewAt(tree: Tree, template: string[], params: Record<string, string>) {
  const self = routeAt(tree, template);
  if (self && childrenAt(tree, template).length === 0) return openRoute(tree, self, params);
  return <RouteList tree={tree} template={template} params={params} />;
}

/** Open a command: pick any path params it still needs, then its form (or live search). */
export function openRoute(tree: Tree, route: Route, params: Record<string, string>, values?: FormValues): ReactElement {
  const [missing] = missingParams(route, params);
  if (missing) {
    const at = route.path.findIndex((s) => s === `:${missing}`);
    return (
      <ParamPicker
        tree={tree}
        template={route.path.slice(0, at + 1)}
        params={params}
        name={missing}
        next={(value) => openRoute(tree, route, { ...params, [missing]: value }, values)}
      />
    );
  }
  if (isLiveSearch(route) && !values) return <LiveSearch tree={tree} route={route} params={params} />;
  return <CommandForm tree={tree} route={route} params={params} initial={values} />;
}

export function segmentTitle(segment: string): string {
  return segment.startsWith(":") ? `‹${paramName(segment)}›` : segment;
}
