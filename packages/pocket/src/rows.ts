// Keyboard focus over a result's typed rows and one row's actions (spec: docs/spec/typed-rows.md,
// "Keys (Pocket / panel)"). Pure: app.ts owns the DOM and feeds keys through `rowKey`.
//
// line ──↓──▶ rows ──↵──▶ actions ──↵──▶ the line, rewritten (and run when nothing else is required)
//  ◀──esc/↑──    ◀──esc───
// A row with exactly one action skips the actions view: ↵ on the row takes it.

import { chainLine } from "../../raycast/src/lib/line";
import type { Chain, Route } from "../../raycast/src/lib/model";

export type Focus =
  | { at: "line" }
  | { at: "rows"; sel: number }
  | { at: "actions"; row: number; sel: number };

export interface RowAction {
  chain: Chain;
  value: string;
  /** `pm ls`: tree + route, as the list shows it. */
  label: string;
  /** The acceptor's one-line `meta.description`. */
  description?: string;
}

/** A result's rows are selectable only when its route declares `rows` (typed rows). */
export function typedRows(route: Route | undefined, rows: unknown[] | undefined): boolean {
  return !!route?.meta?.rows && !!rows?.length;
}

/** Every action `chains` offers this row: the acceptors `acceptorsFor` found, plus `completeFrom` chains. */
export function rowActions(chains: Chain[], row: unknown): RowAction[] {
  const out: RowAction[] = [];
  for (const chain of chains) {
    const value = chain.valueOf(row);
    if (!value) continue;
    const description = chain.route.meta?.description;
    out.push({
      chain,
      value,
      label: `${chain.tree.name} ${chain.route.path.join(" ")}`.trim(),
      ...(description ? { description: description.split("\n")[0] } : {}),
    });
  }
  return out;
}

/** The line an action writes: `pm ls "/Heat.1995/" `, quoted as the line parser reads it. */
export function actionLine(a: RowAction): string {
  return chainLine(a.chain.tree, a.chain.route, a.chain.arg, a.chain.source, a.value);
}

export type RowKey = "down" | "up" | "enter" | "escape";

export type RowStep =
  | { focus: Focus }
  /** Put `line` on the line (focus goes back there); app.ts runs it when the line is runnable. */
  | { focus: Focus; take: string };

/**
 * One key while focus is in the result. `rows` are the result's rows, `chains` its chains.
 * Returns undefined when the key is not the result's (focus on the line and not ↓, or no typed rows),
 * so the caller handles it as before.
 */
export function rowKey(focus: Focus, key: RowKey, rows: unknown[], chains: Chain[]): RowStep | undefined {
  const last = rows.length - 1;
  switch (focus.at) {
    case "line":
      return key === "down" && rows.length ? { focus: { at: "rows", sel: 0 } } : undefined;
    case "rows": {
      const sel = Math.min(focus.sel, last);
      if (key === "down") return { focus: { at: "rows", sel: Math.min(sel + 1, last) } };
      if (key === "up") return { focus: sel <= 0 ? { at: "line" } : { at: "rows", sel: sel - 1 } };
      if (key === "escape") return { focus: { at: "line" } };
      const acts = rowActions(chains, rows[sel]);
      if (acts.length === 0) return { focus };
      if (acts.length === 1) return { focus: { at: "line" }, take: actionLine(acts[0]!) };
      return { focus: { at: "actions", row: sel, sel: 0 } };
    }
    case "actions": {
      const acts = rowActions(chains, rows[focus.row]);
      const sel = Math.min(focus.sel, Math.max(0, acts.length - 1));
      if (key === "down") return { focus: { ...focus, sel: Math.min(sel + 1, Math.max(0, acts.length - 1)) } };
      if (key === "up") return { focus: { ...focus, sel: Math.max(sel - 1, 0) } };
      if (key === "escape") return { focus: { at: "rows", sel: focus.row } };
      const a = acts[sel];
      return a ? { focus: { at: "line" }, take: actionLine(a) } : { focus: { at: "rows", sel: focus.row } };
    }
  }
}
