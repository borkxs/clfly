import { Action, ActionPanel, Alert, confirmAlert, Icon, List, useNavigation } from "@raycast/api";
import { useCachedPromise, useCachedState } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import { runTree } from "../lib/exec";
import {
  accept,
  analyze,
  candidates,
  chainLine,
  expansions,
  isQuick,
  onEnter,
  quickCandidates,
  quickLines,
  type Candidate,
  type Choice,
  type Expansion,
  type LineState,
} from "../lib/line";
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
import { loadChoices, useChoices } from "./useChoices";
import { completeFromArgv } from "@clfly/core/complete";
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
  line: Icon.Terminal,
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
  const [picks, setPicks] = useCachedState<Record<string, string>>("quick-picks", {});
  const expanded = useExpansionChoices(trees);
  const lines = useMemo(() => quickLines(trees, expanded), [trees, expanded]);
  const quick = isQuick(state);
  const rows = quick
    ? quickCandidates(line, lines, { recent, picks })
    : candidates(state, trees, choices.data ?? []);

  async function run(s: LineState = state) {
    const { tree, route } = s;
    if (!tree || !route || !s.runnable) return;
    if (s.destructive) {
      const ok = await confirmAlert({
        title: `Run ${s.line.trim()}?`,
        message: "This changes or removes something.",
        primaryAction: { title: "Run", style: Alert.ActionStyle.Destructive },
      });
      if (!ok) return;
    }
    remember(s.line);
    push(<ResultView tree={tree} route={route} params={s.params} values={s.values} />);
  }

  /**
   * Recent lines: what ran, plus a live search when one of its hits is taken (the search
   * itself never runs). Lines carrying a hash or id from a result (`pm add <hash>`) are
   * one-offs and stay out; the search that found them is the line worth repeating.
   */
  function remember(l: string) {
    const t = l.trim();
    if (!t || t.split(/\s+/).some(isResultId)) return;
    setRecent((prev) => [t, ...prev.filter((x) => x !== t)].slice(0, 20));
  }

  /** ↵ on a row: run the line it completes, or put it on the line. */
  function enter(c: Candidate) {
    if (quick && c.kind === "line") setPicks({ ...picks, [line.trim().toLowerCase()]: c.text });
    const r = onEnter(trees, state, c);
    if ("run" in r) void run(r.run);
    else setLine(r.line);
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
      {state.error && !quick && (
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
                <Action title={enterTitle(trees, state, c)} icon={c.kind === "run" ? Icon.Play : Icon.ArrowRight} onAction={() => enter(c)} />
                {c.kind !== "run" && (
                  <Action
                    title={`Take “${c.text}”`}
                    icon={Icon.Text}
                    shortcut={{ modifiers: ["opt"], key: "return" }}
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
                        onAction={() => {
                          remember(line);
                          setLine(chainLine(state.tree!, chain.route, chain.arg, chain.source, value));
                        }}
                      />
                    )}
                    {live.chains.slice(1).map((ch) => {
                      const v = ch.valueOf(row);
                      return v ? (
                        <Action
                          key={`${ch.route.path.join(" ")}:${ch.arg}`}
                          title={`${state.tree!.name} ${ch.route.path.join(" ")}`}
                          icon={Icon.ArrowRight}
                          onAction={() => {
                            remember(line);
                            setLine(chainLine(state.tree!, ch.route, ch.arg, ch.source, v));
                          }}
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

/** A hash or transfer id from a result row: 32+ hex, or a 22-char mixed-case id with a digit. */
function isResultId(word: string): boolean {
  const w = word.replace(/^["']|["']$/g, "");
  if (/^[0-9a-f]{32,}$/i.test(w)) return true;
  return /^[A-Za-z0-9_-]{22}$/.test(w) && /[A-Z]/.test(w) && /[a-z]/.test(w) && /\d/.test(w);
}

function enterTitle(trees: Tree[], state: LineState, c: Candidate): string {
  const r = onEnter(trees, state, c);
  if (!("run" in r)) return `Take “${c.text}”`;
  return r.run.destructive ? "Run (asks first)" : `Run ${r.run.line.trim()}`;
}

/** Choices of every short, harmless choice list, so quick mode can offer `dash open film`. */
function useExpansionChoices(trees: Tree[]): (e: Expansion) => Choice[] | undefined {
  const sources = useMemo(() => {
    const seen = new Map<string, { bin: string; argv: string[]; cf: Expansion["cf"] }>();
    for (const e of expansions(trees)) {
      const argv = completeFromArgv(e.cf, e.tree.name, {});
      seen.set(`${e.tree.bin}\0${JSON.stringify(argv)}`, { bin: e.tree.bin, argv, cf: e.cf });
    }
    return [...seen.entries()];
  }, [trees]);
  const { data } = useCachedPromise(
    async (key: string) => {
      const list = JSON.parse(key) as [string, { bin: string; argv: string[]; cf: Expansion["cf"] }][];
      const got = await Promise.all(
        list.map(([k, s]) =>
          loadChoices(s.bin, JSON.stringify(s.argv), JSON.stringify(s.cf)).then(
            (c) => [k, c] as const,
            () => [k, []] as const
          )
        )
      );
      return Object.fromEntries(got) as Record<string, Choice[]>;
    },
    [JSON.stringify(sources)],
    { execute: sources.length > 0, keepPreviousData: true }
  );
  return useMemo(
    () => (e: Expansion) => data?.[`${e.tree.bin}\0${JSON.stringify(completeFromArgv(e.cf, e.tree.name, {}))}`],
    [data]
  );
}

function sectionTitle(state: LineState): string {
  if (isQuick(state)) return "Commands";
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
