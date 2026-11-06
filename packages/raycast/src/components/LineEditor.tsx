import { Action, ActionPanel, Alert, confirmAlert, Icon, List, useNavigation } from "@raycast/api";
import { useCachedState } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import { runTree } from "../lib/exec";
import { accept, analyze, candidates, chainLine, type Candidate, type LineState } from "../lib/line";
import { DEFAULT_POLICY, LiveSearcher, type LiveState } from "../lib/live";
import {
  buildArgv,
  chainsFor,
  commandLine,
  rowAccessories,
  rowSubtitle,
  rowTitle,
  shapeOutput,
  type Route,
  type FormValues,
  type Shaped,
  type Tree,
} from "../lib/model";
import { preferences } from "../lib/exec";
import { ResultView } from "./ResultView";
import { useChoices } from "./useChoices";
import { useTrees } from "./useTrees";

const NO_TREE: Tree = { name: "", bin: "", root: "", routes: [] };
const ICONS: Record<Candidate["kind"], Icon> = {
  tree: Icon.Folder,
  segment: Icon.ChevronRight,
  choice: Icon.Dot,
  flag: Icon.Switch,
  value: Icon.Dot,
  run: Icon.Play,
  search: Icon.MagnifyingGlass,
};

/**
 * The whole launcher as one line: the search bar is the command line, the rows
 * are what the next word can be. ↵ takes a row (or runs, on the Run row), ⌘↵ runs
 * the line as typed. Cases it must handle: test/fixtures/line-cases.json.
 */
export function LineEditor({ initial = "" }: { initial?: string }) {
  const { data: trees = [], isLoading } = useTrees();
  const [line, setLine] = useState(initial);
  const [recent, setRecent] = useCachedState<string[]>("recent-lines", []);
  const { push } = useNavigation();
  const state = useMemo(() => analyze(trees, line), [trees, line]);
  const choices = useChoices(state.tree ?? NO_TREE, state.source, state.values);
  const live = useLive(state);
  const rows = candidates(state, trees, choices.data ?? []);

  async function run() {
    const { tree, route } = state;
    if (!tree || !route || !state.runnable) return;
    if (state.destructive) {
      const ok = await confirmAlert({
        title: `Run ${line.trim()}?`,
        message: "This changes or removes something.",
        primaryAction: { title: "Run", style: Alert.ActionStyle.Destructive },
      });
      if (!ok) return;
    }
    const trimmed = line.trim();
    setRecent([trimmed, ...recent.filter((l) => l !== trimmed)].slice(0, 20));
    push(<ResultView tree={tree} route={route} params={state.params} values={state.values} />);
  }

  const lineActions = (
    <>
      {state.runnable && (
        <Action title="Run Line" icon={Icon.Play} shortcut={{ modifiers: ["cmd"], key: "return" }} onAction={run} />
      )}
      {state.tree && state.route && (
        <Action.CopyToClipboard
          title="Copy Command"
          content={commandLine(state.tree.name, buildArgv(state.route, state.params, state.values).slice(0, -1))}
          shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
        />
      )}
      <Action
        title="Clear Line"
        icon={Icon.XMarkCircle}
        shortcut={{ modifiers: ["cmd"], key: "backspace" }}
        onAction={() => setLine("")}
      />
    </>
  );

  const title = state.hint.length
    ? `needs ${state.hint.map((h) => (h.startsWith("--") ? h : `‹${h}›`)).join(" ")}`
    : "clfly";
  return (
    <List
      isLoading={isLoading || choices.isLoading || live.loading}
      filtering={false}
      searchText={line}
      onSearchTextChange={setLine}
      searchBarPlaceholder="pm search dune · dash open film · run ls"
      navigationTitle={title}
    >
      {state.error && (
        <List.EmptyView icon={Icon.Warning} title={state.error} description="Type a tree name: pm, dash, run…" />
      )}
      {line === "" && recent.length > 0 && (
        <List.Section title="Recent">
          {recent.map((l) => (
            <List.Item
              key={l}
              title={l}
              icon={Icon.Clock}
              actions={
                <ActionPanel>
                  <Action title="Use Line" icon={Icon.Text} onAction={() => setLine(`${l} `)} />
                  <Action title="Forget" icon={Icon.Trash} onAction={() => setRecent(recent.filter((x) => x !== l))} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
      <List.Section title={sectionTitle(state)}>
        {rows.map((c) => (
          <List.Item
            key={`${c.kind}:${c.text}`}
            title={c.title}
            subtitle={c.subtitle}
            icon={c.kind === "run" && state.destructive ? Icon.Trash : ICONS[c.kind]}
            actions={
              <ActionPanel>
                {c.kind === "run" ? (
                  <Action title={state.destructive ? "Run (asks first)" : "Run"} icon={Icon.Play} onAction={run} />
                ) : (
                  <Action
                    title={`Take “${c.text}”`}
                    icon={Icon.ArrowRight}
                    onAction={() => setLine(accept(state, c))}
                  />
                )}
                {lineActions}
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      {live.rows.length > 0 && state.tree && state.route && (
        <List.Section
          title={`${state.tree.name} ${state.route.path.join(" ")} “${live.query}”`}
          subtitle={`${live.rows.length}`}
        >
          {live.rows.map((row, i) => {
            const chain = live.chains[0];
            const value = chain?.valueOf(row);
            return (
              <List.Item
                key={i}
                title={rowTitle(row)}
                subtitle={rowSubtitle(row)}
                accessories={rowAccessories(row).map(([k, v]) => ({ text: v, tooltip: k }))}
                actions={
                  <ActionPanel>
                    {chain && value && (
                      <Action
                        title={`${state.tree!.name} ${chain.route.path.join(" ")}`}
                        icon={Icon.ArrowRight}
                        onAction={() => setLine(chainLine(state.tree!, chain.route, chain.arg, chain.source, value))}
                      />
                    )}
                    {live.chains.slice(1).map((ch) => {
                      const v = ch.valueOf(row);
                      return v ? (
                        <Action
                          key={`${ch.route.path.join(" ")}:${ch.arg}`}
                          title={`${state.tree!.name} ${ch.route.path.join(" ")}`}
                          icon={Icon.ArrowRight}
                          onAction={() => setLine(chainLine(state.tree!, ch.route, ch.arg, ch.source, v))}
                        />
                      ) : null;
                    })}
                    <Action.CopyToClipboard title="Copy Title" content={rowTitle(row)} />
                    {lineActions}
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      )}
    </List>
  );
}

function sectionTitle(state: LineState): string {
  switch (state.slot.kind) {
    case "tree":
      return "Trees";
    case "segment":
      return state.slot.positional ? `Commands or ‹${state.slot.positional}›` : "Commands";
    case "positional":
      return `‹${state.slot.name}›${state.source ? ` from ${state.source.cmd}` : ""}`;
    case "flag":
      return "Flags";
    case "flagValue":
      return `--${state.slot.flag.name}`;
    default:
      return "";
  }
}

/** Search-as-you-type under the line when it is a live search with a query (pm search dune). */
function useLive(state: LineState) {
  const { tree, route, params, values, live: query } = state;
  const key = tree && route ? `${tree.name} ${route.path.join(" ")}` : "";
  const [result, setResult] = useState<LiveState<Shaped>>({ status: "idle" });
  const searcher = useMemo(() => {
    if (!tree || !route) return undefined;
    const limit = String(Number(preferences().searchLimit) || 25);
    return new LiveSearcher<Shaped>(
      async (q) => {
        const extra: FormValues = route.flags.some((f) => f.name === "limit") && !values.limit ? { limit } : {};
        const res = await runTree(tree, buildArgv(route, params, { ...values, ...extra, query: q }));
        if (res.code !== 0) throw new Error(res.error ?? `exited ${res.code}`);
        return shapeOutput(res.json);
      },
      setResult,
      DEFAULT_POLICY
    );
    // Flags change the search; the query itself goes through searcher.type.
  }, [key, JSON.stringify({ ...values, query: undefined })]);
  useEffect(() => () => searcher?.dispose(), [searcher]);
  useEffect(() => {
    if (searcher && query) searcher.type(query);
  }, [searcher, query]);

  const shaped = result.status === "done" ? result.value : result.status === "loading" ? result.previous : undefined;
  const active = Boolean(query && searcher);
  return {
    loading: active && result.status === "loading",
    query: result.status === "idle" ? query : result.query,
    rows: active && shaped?.kind === "rows" ? shaped.rows : [],
    chains: active && shaped && tree && route ? chainsFor(tree, route as Route, shaped) : [],
  };
}
