import { Action, ActionPanel, Alert, confirmAlert, Detail, Icon, List, useNavigation } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useRef, useState } from "react";
import { runTree, type RunResult } from "../lib/exec";
import {
  buildArgv,
  chainsFor,
  commandLine,
  isDestructive,
  rowAccessories,
  rowSubtitle,
  rowTitle,
  scalarFields,
  shapeOutput,
  type Chain,
  type FormValues,
  type Route,
  type Tree,
} from "../lib/model";
import { FavoriteActions } from "./FavoriteActions";
import { openRoute } from "./navigate";

const MAX_DETAIL = 60_000;

function fence(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const cut = text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}\n… (${text.length - MAX_DETAIL} more chars; copy for all)` : text;
  return `\`\`\`${typeof value === "string" ? "" : "json"}\n${cut}\n\`\`\``;
}

/**
 * Run the command and show its JSON: arrays as rows, anything else as a
 * Detail. Destructive commands ask first; declining runs nothing.
 */
export function ResultView(props: { tree: Tree; route: Route; params: Record<string, string>; values: FormValues }) {
  const { tree, route, params, values } = props;
  const argv = buildArgv(route, params, values);
  const line = commandLine(tree.name, argv);
  const { pop } = useNavigation();
  const abort = useRef<AbortController>(null);
  const [showDetail, setShowDetail] = useState(false);

  const { data, isLoading, revalidate } = usePromise(
    async (key: string): Promise<RunResult | "cancelled"> => {
      if (isDestructive(route)) {
        const ok = await confirmAlert({
          title: `Run ${line.replace(/ --json$/, "")}?`,
          message: route.meta?.description ?? "This command changes or removes state.",
          primaryAction: { title: "Run", style: Alert.ActionStyle.Destructive },
        });
        if (!ok) return "cancelled";
      }
      return runTree(tree, JSON.parse(key) as string[], { signal: abort.current?.signal });
    },
    [JSON.stringify(argv)],
    { abortable: abort },
  );

  const common = (
    <>
      <Action title="Run Again" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={revalidate} />
      <Action.CopyToClipboard title="Copy Command" content={line} shortcut={{ modifiers: ["cmd", "shift"], key: "c" }} />
      {data && data !== "cancelled" && (
        <Action.CopyToClipboard title="Copy Output" content={data.stdout || data.stderr} shortcut={{ modifiers: ["cmd", "opt"], key: "c" }} />
      )}
      <Action.Push title="Edit Arguments" icon={Icon.Pencil} shortcut={{ modifiers: ["cmd"], key: "e" }} target={openRoute(tree, route, params, values)} />
      <FavoriteActions tree={tree} route={route} params={params} values={values} />
    </>
  );

  if (data === "cancelled") {
    return (
      <Detail
        markdown={`Cancelled. Nothing ran.\n\n${fence(line)}`}
        actions={
          <ActionPanel>
            <Action title="Back" icon={Icon.ArrowLeft} onAction={pop} />
            {common}
          </ActionPanel>
        }
      />
    );
  }
  if (!data || data.code !== 0 || data.json === undefined) {
    const md = !data
      ? `Running…\n\n${fence(line)}`
      : data.code !== 0
        ? `## Failed (exit ${data.code})\n\n${data.error ?? ""}\n\n${fence(line)}\n\n${data.stderr ? fence(data.stderr) : ""}`
        : fence(data.stdout || "(no output)");
    return <Detail isLoading={isLoading} navigationTitle={line} markdown={md} actions={<ActionPanel>{common}</ActionPanel>} />;
  }

  const shaped = shapeOutput(data.json);
  if (shaped.kind === "value") {
    return <Detail isLoading={isLoading} navigationTitle={line} markdown={fence(shaped.value)} actions={<ActionPanel>{common}</ActionPanel>} />;
  }

  const chains = chainsFor(tree, route, shaped);
  const extras = Object.entries(shaped.extras).map(([k, v]) => `${k}: ${String(v)}`).join(" · ");
  return (
    <List
      isLoading={isLoading}
      navigationTitle={`${line.replace(/ --json$/, "")} · ${shaped.rows.length} rows · ${data.ms} ms`}
      isShowingDetail={showDetail}
      searchBarPlaceholder={extras || "Filter rows"}
    >
      {shaped.rows.length === 0 && <List.EmptyView title="No rows" description={extras} />}
      {shaped.rows.map((row, i) => (
        <List.Item
          key={i}
          title={rowTitle(row)}
          subtitle={showDetail ? undefined : rowSubtitle(row)}
          accessories={showDetail ? [] : rowAccessories(row).map(([k, text]) => ({ text, tooltip: k }))}
          detail={<List.Item.Detail markdown={fence(row)} />}
          actions={
            <ActionPanel>
              <ChainActions tree={tree} chains={chains} row={row} />
              <Action.CopyToClipboard title="Copy Title" content={rowTitle(row)} />
              <Action title={showDetail ? "Hide Detail" : "Show Detail"} icon={Icon.Sidebar} shortcut={{ modifiers: ["cmd"], key: "d" }} onAction={() => setShowDetail((s) => !s)} />
              <ActionPanel.Section title="Copy">
                <Action.CopyToClipboard title="Copy Row JSON" content={JSON.stringify(row, null, 2)} shortcut={{ modifiers: ["cmd", "shift"], key: "j" }} />
                {scalarFields(row).map(([k, v]) => (
                  <Action.CopyToClipboard key={k} title={`Copy ${k}`} content={v} />
                ))}
              </ActionPanel.Section>
              <ActionPanel.Section>{common}</ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

/** One action per command whose `completeFrom` reads from this output. */
export function ChainActions(props: { tree: Tree; chains: Chain[]; row: unknown }) {
  const { tree, chains, row } = props;
  return (
    <>
      {chains.map((c) => {
        const value = c.valueOf(row);
        if (value === undefined) return null;
        const target =
          c.source === "path"
            ? openRoute(tree, c.route, { [c.arg]: value })
            : openRoute(tree, c.route, {}, { [c.arg]: value });
        const name = c.route.path.map((s) => (s === `:${c.arg}` ? value : s)).join(" ");
        return (
          <Action.Push
            key={`${c.route.path.join(" ")} ${c.arg}`}
            title={`${tree.name} ${name}`}
            icon={Icon.ArrowRight}
            target={target}
          />
        );
      })}
    </>
  );
}
