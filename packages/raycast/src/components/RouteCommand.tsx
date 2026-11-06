import { Detail, Icon, List } from "@raycast/api";
import { isDestructive, isLiveSearch, routeAt, runsBare, type FormValues } from "../lib/model";
import { LiveSearch } from "./LiveSearch";
import { openRoute } from "./navigate";
import { ResultView } from "./ResultView";
import { useTrees } from "./useTrees";

/** What a generated root-search command opens (see scripts/gen-tree-commands.mjs). */
export interface RouteSpec {
  tree: string;
  path: string[];
  /** Path params fixed at gen time (`run transcribe-batch`). */
  params?: Record<string, string>;
  /** Form values fixed at gen time (`dash open film`). */
  values?: FormValues;
  /** Form names of the Raycast arguments `a0`, `a1`, `a2`, in order. */
  argNames?: string[];
}

/**
 * One route as a root-search command. Runs at once when nothing is left to
 * ask and the command is safe; a live search opens with its query filled;
 * anything else opens the route's form or param picker.
 */
export function RouteCommand({ spec, args = {} }: { spec: RouteSpec; args?: Record<string, string> }) {
  const { data: trees, isLoading, error } = useTrees();
  const tree = trees?.find((t) => t.name === spec.tree);
  const route = tree && routeAt(tree, spec.path);
  if (!tree || !route) {
    if (isLoading) return <List isLoading />;
    const why =
      error?.message ??
      `No command \`${spec.tree} ${spec.path.join(" ")}\` in the linked trees. Rerun \`npm run gen-trees\`.`;
    return <Detail markdown={`# ${spec.tree} ${spec.path.join(" ")}\n\n${why}`} />;
  }
  if (tree.error)
    return (
      <List>
        <List.EmptyView icon={Icon.Warning} title={`${tree.name} failed to load`} description={tree.error} />
      </List>
    );

  const params = spec.params ?? {};
  const values: FormValues = { ...spec.values };
  (spec.argNames ?? []).forEach((name, i) => {
    const v = args[`a${i}`]?.trim();
    if (v) values[name] = v;
  });
  const given = Object.keys(values).length > 0;

  if (isLiveSearch(route))
    return (
      <LiveSearch
        tree={tree}
        route={route}
        params={params}
        initialQuery={typeof values.query === "string" ? values.query : undefined}
      />
    );
  if (given && runsBare(route, params, values) && !isDestructive(route))
    return <ResultView tree={tree} route={route} params={params} values={values} />;
  return openRoute(tree, route, params, given ? values : undefined);
}
