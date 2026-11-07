import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { preferences, runTree } from "../lib/exec";
import { DEFAULT_POLICY, LiveSearcher, type LiveState } from "../lib/live";
import {
  buildArgv,
  chainsFor,
  runArgs,
  commandLine,
  displayPath,
  formatBytes,
  rowAccessories,
  rowSubtitle,
  rowTitle,
  shapeOutput,
  type Route,
  type Shaped,
  type Tree,
} from "../lib/model";
import { suggestCompletions, type Hit } from "../lib/release";
import { CommandForm } from "./CommandForm";
import { FavoriteActions } from "./FavoriteActions";
import { ChainActions } from "./ResultView";
import { useTrees } from "./useTrees";

/**
 * Search-as-you-type for a read-only command whose first positional is
 * `query` (pm search). Rows with a `title` also get completions: the most
 * common normalized release title, with its best-seeded hit as the default pick.
 */
export function LiveSearch(props: { tree: Tree; route: Route; params: Record<string, string>; initialQuery?: string }) {
  const { tree, route, params } = props;
  const limit = String(Number(preferences().searchLimit) || 25);
  const filter = route.flags.find((f) => f.enum?.length && f.type === "string");
  const [filterValue, setFilterValue] = useState("");
  const [text, setText] = useState(props.initialQuery ?? "");
  const [state, setState] = useState<LiveState<Shaped>>({ status: "idle" });

  const flagValues = (query: string) => ({
    query,
    ...(route.flags.some((f) => f.name === "limit") ? { limit } : {}),
    ...(filter && filterValue ? { [filter.name]: filterValue } : {}),
  });

  const searcher = useMemo(
    () =>
      new LiveSearcher<Shaped>(
        async (query) => {
          const res = await runTree(tree, buildArgv(route, params, flagValues(query)));
          if (res.code !== 0) throw new Error(res.error ?? `exited ${res.code}`);
          return shapeOutput(res.json);
        },
        setState,
        DEFAULT_POLICY,
      ),
    [tree.name, route.path.join(" "), filterValue],
  );
  useEffect(() => {
    searcher.type(text);
    return () => searcher.dispose();
  }, [searcher]);

  const onText = (t: string) => {
    setText(t);
    searcher.type(t);
  };
  const complete = (to: string) => {
    setText(to);
    searcher.submit(to);
  };

  const shaped = state.status === "done" ? state.value : state.status === "loading" ? state.previous : undefined;
  const rows = shaped?.kind === "rows" ? shaped.rows : [];
  const titled = rows.filter((r): r is Hit => typeof (r as Hit)?.title === "string");
  const suggestions = titled.length ? suggestCompletions(titled) : [];
  const top = suggestions[0];
  const { data: trees } = useTrees();
  const chains = shaped ? chainsFor(tree, route, shaped, { trees, args: runArgs(params, { query: text }) }) : [];
  const title = [tree.name, displayPath(route.path, params)].join(" ");
  const s = searcher.stats;

  const rowActions = (row: unknown, query: string) => (
    <ActionPanel>
      <ChainActions chains={chains} row={row} />
      {top && <Action title={`Complete to “${top.completion}”`} icon={Icon.Text} shortcut={{ modifiers: ["cmd"], key: "arrowRight" }} onAction={() => complete(top.completion)} />}
      <Action title="Search Now" icon={Icon.MagnifyingGlass} shortcut={{ modifiers: ["cmd"], key: "return" }} onAction={() => searcher.submit(text)} />
      <Action.CopyToClipboard title="Copy Title" content={rowTitle(row)} />
      <Action.CopyToClipboard title="Copy Row JSON" content={JSON.stringify(row, null, 2)} shortcut={{ modifiers: ["cmd", "shift"], key: "j" }} />
      <Action.Push title="Open as Form" icon={Icon.Pencil} shortcut={{ modifiers: ["cmd"], key: "e" }} target={<CommandForm tree={tree} route={route} params={params} initial={flagValues(query)} />} />
      <Action.CopyToClipboard title="Copy Command" content={commandLine(tree.name, buildArgv(route, params, flagValues(query)))} />
      <FavoriteActions tree={tree} route={route} params={params} values={flagValues(query)} />
    </ActionPanel>
  );

  const query = state.status === "idle" ? text : state.query;
  return (
    <List
      navigationTitle={`${title} · ${s.launches} runs${s.cacheHits ? ` · ${s.cacheHits} cached` : ""}`}
      isLoading={state.status === "loading"}
      filtering={false}
      searchText={text}
      onSearchTextChange={onText}
      searchBarPlaceholder={`${title} (live, ${DEFAULT_POLICY.minLength}+ chars)`}
      searchBarAccessory={
        filter ? (
          <List.Dropdown tooltip={`--${filter.name}`} value={filterValue} onChange={setFilterValue}>
            <List.Dropdown.Item value="" title={`any ${filter.name}`} />
            {filter.enum!.map((e) => (
              <List.Dropdown.Item key={String(e)} value={String(e)} title={String(e)} />
            ))}
          </List.Dropdown>
        ) : undefined
      }
    >
      {state.status === "failed" && (
        <List.EmptyView
          icon={Icon.Warning}
          title={state.paused ? "Paused after 3 failures in a row" : `${title} failed`}
          description={`${state.error}${state.paused ? "\n⌘↵ retries (indexers are rate-limited; typing will not)" : ""}`}
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "return" }} onAction={() => searcher.submit(text)} />
            </ActionPanel>
          }
        />
      )}
      {state.status === "idle" && <List.EmptyView icon={Icon.MagnifyingGlass} title={`Type to search (${title})`} />}
      {top && (
        <List.Section title="Best pick">
          <List.Item
            title={top.best.title}
            subtitle={top.completion}
            icon={Icon.Star}
            accessories={hitAccessories(top.best)}
            actions={rowActions(top.best, query)}
          />
        </List.Section>
      )}
      {suggestions.length > 0 && (
        <List.Section title="Complete to">
          {suggestions.map((g) => (
            <List.Item
              key={g.normalized.key}
              title={g.completion}
              subtitle={`${g.count} releases`}
              icon={Icon.Text}
              accessories={[{ text: `best ${g.best.seeders ?? 0} seeders`, tooltip: g.best.title }]}
              actions={
                <ActionPanel>
                  <Action title={`Search “${g.completion}”`} icon={Icon.MagnifyingGlass} onAction={() => complete(g.completion)} />
                  <ChainActions chains={chains} row={g.best} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
      {rows.length > 0 && (
        <List.Section title={`Hits · ${rows.length}`}>
          {rows.map((row, i) => (
            <List.Item
              key={i}
              title={rowTitle(row)}
              subtitle={rowSubtitle(row)}
              accessories={hitAccessories(row)}
              actions={rowActions(row, query)}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}

function hitAccessories(row: unknown) {
  const r = row as { seeders?: number; sizeBytes?: number; resolution?: string; indexer?: string };
  if (typeof r.seeders !== "number" && typeof r.sizeBytes !== "number") {
    return rowAccessories(row).map(([k, text]) => ({ text, tooltip: k }));
  }
  return [
    ...(r.resolution ? [{ tag: r.resolution }] : []),
    ...(typeof r.sizeBytes === "number" ? [{ text: formatBytes(r.sizeBytes) }] : []),
    ...(typeof r.seeders === "number" ? [{ text: `${r.seeders}↑`, tooltip: r.indexer ? `seeders · ${r.indexer}` : "seeders" }] : []),
  ];
}
