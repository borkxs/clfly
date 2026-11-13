// A run that stopped for an answer (clfly core `ctx.ask` off a terminal: exit 10, an `input_required`
// result on stdout). The superbar shows the question in place, takes a pick, and reruns the same argv
// with every answer so far as `--answer key=choice`; nothing stays alive between runs. Pure: app.ts
// owns the DOM. Mirrors core's `InputRequiredResult` by shape only, so pocket needs no core change.
//
// line ──↓──▶ choices (the suggested one first) ──↵──▶ rerun with the answer
//  ◀──esc/↑──

import type { Focus } from "./rows";

export interface AskChoice {
  key: string;
  label: string;
  hint?: string;
  /** Row data to render the choice with (a `pm.hit` row for "Select a release"). */
  row?: unknown;
}

export interface Question {
  key: string;
  message: string;
  choices: AskChoice[];
  initial?: string;
}

export interface InputRequired {
  questions: Question[];
  /** The answers the stopped run was given; the rerun sends them again plus the new one. */
  answers: Record<string, string>;
}

/** The exit code core gives a run that stopped for input. */
export const INPUT_REQUIRED_EXIT = 10;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The question a run's JSON result asks, or undefined when it is an ordinary result. */
export function inputRequired(json: unknown): InputRequired | undefined {
  if (!isRecord(json) || json.resultType !== "input_required" || !isRecord(json.inputRequests)) return undefined;
  const questions: Question[] = [];
  for (const [key, req] of Object.entries(json.inputRequests)) {
    if (!isRecord(req) || !Array.isArray(req.choices)) continue;
    const choices = req.choices.filter(
      (c): c is AskChoice => isRecord(c) && typeof c.key === "string" && typeof c.label === "string",
    );
    if (!choices.length) continue;
    questions.push({
      key,
      message: typeof req.message === "string" ? req.message : key,
      choices,
      ...(typeof req.initial === "string" ? { initial: req.initial } : {}),
    });
  }
  if (!questions.length) return undefined;
  const answers: Record<string, string> = {};
  if (isRecord(json.answers)) for (const [k, v] of Object.entries(json.answers)) if (typeof v === "string") answers[k] = v;
  return { questions, answers };
}

/** `argv` with its `--answer` pairs replaced by `answers`, one `--answer key=value` each. */
export function answerArgv(argv: string[], answers: Record<string, string>): string[] {
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const w = argv[i]!;
    if (w === "--") {
      rest.push(...argv.slice(i));
      break;
    }
    if (w === "--answer") i++;
    else if (!w.startsWith("--answer=")) rest.push(w);
  }
  const pairs = Object.entries(answers).flatMap(([k, v]) => ["--answer", `${k}=${v}`]);
  const dash = rest.indexOf("--");
  return dash < 0 ? [...rest, ...pairs] : [...rest.slice(0, dash), ...pairs, ...rest.slice(dash)];
}

/** Where ↓ lands: the suggested choice, else the first. */
export function initialIndex(q: Question): number {
  const at = q.initial === undefined ? -1 : q.choices.findIndex((c) => c.key === q.initial);
  return at < 0 ? 0 : at;
}

export type AskKey = "down" | "up" | "enter" | "escape";

export type AskStep =
  | { focus: Focus }
  /** Rerun with `answers` (the earlier ones plus this pick). */
  | { focus: Focus; answers: Record<string, string> };

/**
 * One key while a question is open. Undefined when the key is not the question's (on the line and
 * not ↓), so the caller handles it as before.
 */
export function askKey(focus: Focus, key: AskKey, ir: InputRequired): AskStep | undefined {
  const q = ir.questions[0];
  if (!q) return undefined;
  const last = q.choices.length - 1;
  if (focus.at === "line") return key === "down" ? { focus: { at: "rows", sel: initialIndex(q) } } : undefined;
  const sel = Math.min(focus.at === "rows" ? focus.sel : focus.row, last);
  if (key === "down") return { focus: { at: "rows", sel: Math.min(sel + 1, last) } };
  if (key === "up") return { focus: sel <= 0 ? { at: "line" } : { at: "rows", sel: sel - 1 } };
  if (key === "escape") return { focus: { at: "line" } };
  return { focus: { at: "line" }, answers: { ...ir.answers, [q.key]: q.choices[sel]!.key } };
}
