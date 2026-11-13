import { createInterface } from "node:readline/promises";
import { ClflyError } from "./errors.js";

/**
 * One answer a question accepts. `key` names the thing itself (an infohash, a
 * media kind), never its position, so a rerun whose choices come back in
 * another order still means the same thing.
 */
export interface AskChoice {
  key: string;
  label: string;
  hint?: string;
  /** Row data a caller can render the choice with (e.g. a `pm.hit` row). */
  row?: unknown;
}

/** A question a command asks mid-run: `ctx.ask(question)` resolves to a choice key. */
export interface AskQuestion {
  /** Stable per question within the command, e.g. `hit` or `dest`. */
  key: string;
  message: string;
  choices: AskChoice[];
  /** Key preselected on a terminal. */
  initial?: string;
}

/** What a non-terminal caller gets for one open question (MRTR `inputRequests` entry). */
export interface InputRequest {
  message: string;
  choices: AskChoice[];
  initial?: string;
}

/**
 * The run stopped at a question its caller has no answer for. Rerun the same
 * line with `answers` plus one for each `inputRequests` key
 * (`--answer <key>=<choice key>`); nothing stays alive in between. Shaped after
 * MRTR `input_required` so an MCP projection is a mapping.
 */
export interface InputRequiredResult {
  resultType: "input_required";
  inputRequests: Record<string, InputRequest>;
  /** The answers this run was given, to send back with the new one. */
  answers: Record<string, string>;
}

/** Exit code of a run that stopped for input (not a failure; rerun with the answer). */
export const INPUT_REQUIRED_EXIT = 10;

/** Asks a question on a terminal; resolves to the chosen key. */
export type Prompter = (question: AskQuestion) => Promise<string>;

/** Thrown by `ctx.ask` off a terminal; `createCli` turns it into the input-required result. */
export class InputRequiredError extends ClflyError {
  readonly result: InputRequiredResult;

  constructor(result: InputRequiredResult) {
    const keys = Object.keys(result.inputRequests).join(", ");
    super(`Input required: ${keys}`, INPUT_REQUIRED_EXIT);
    this.name = "InputRequiredError";
    this.result = result;
  }
}

export function isInputRequired(err: unknown): err is InputRequiredError {
  return err instanceof InputRequiredError;
}

/**
 * Build `ctx.ask`. A given answer whose key is still among the choices wins;
 * a stale or missing one prompts on a terminal and otherwise stops the run
 * with an {@link InputRequiredError}.
 */
export function createAsk(opts: {
  answers: Record<string, string>;
  interactive: boolean;
  prompt: Prompter;
}): (question: AskQuestion) => Promise<string> {
  return async (question) => {
    if (question.choices.length === 0) {
      throw new ClflyError(`Nothing to choose for "${question.message}"`);
    }
    const given = opts.answers[question.key];
    if (given !== undefined && question.choices.some((c) => c.key === given)) {
      return given;
    }
    if (opts.interactive) return opts.prompt(question);
    throw new InputRequiredError({
      resultType: "input_required",
      inputRequests: {
        [question.key]: {
          message: question.message,
          choices: question.choices,
          ...(question.initial !== undefined ? { initial: question.initial } : {}),
        },
      },
      answers: { ...opts.answers },
    });
  };
}

/**
 * Pull every `--answer key=value` (or `--answer=key=value`) out of argv. Later
 * answers to the same key win.
 */
export function extractAnswers(argv: string[]): {
  argv: string[];
  answers: Record<string, string>;
} {
  const rest: string[] = [];
  const answers: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") {
      rest.push(...argv.slice(i));
      break;
    }
    let pair: string | undefined;
    if (token === "--answer") {
      pair = argv[++i];
      if (pair === undefined) throw new ClflyError("--answer needs <key>=<value>", 2);
    } else if (token.startsWith("--answer=")) {
      pair = token.slice("--answer=".length);
    } else {
      rest.push(token);
      continue;
    }
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new ClflyError(`--answer needs <key>=<value>, got ${JSON.stringify(pair)}`, 2);
    answers[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return { argv: rest, answers };
}

/** The rerun hint shown on a terminal-less run without `--json`. */
export function formatInputRequired(result: InputRequiredResult): string {
  const lines: string[] = [];
  for (const [key, req] of Object.entries(result.inputRequests)) {
    lines.push(`${req.message} (rerun with --answer ${key}=<key>)`);
    for (const c of req.choices) {
      lines.push(`  ${c.key}  ${c.label}${c.hint ? `  (${c.hint})` : ""}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** Default terminal prompt: a numbered list on stderr, answered by number or key. */
export function readlinePrompter(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stderr,
): Prompter {
  return async (question) => {
    const rl = createInterface({ input, output });
    try {
      output.write(`${question.message}\n`);
      question.choices.forEach((c, i) => {
        const mark = c.key === question.initial ? "*" : " ";
        output.write(`${mark}${i + 1}) ${c.label}${c.hint ? `  (${c.hint})` : ""}\n`);
      });
      for (;;) {
        const raw = (await rl.question("> ")).trim();
        if (raw === "" && question.initial !== undefined) return question.initial;
        const n = Number(raw);
        if (Number.isInteger(n) && n >= 1 && n <= question.choices.length) {
          return question.choices[n - 1]!.key;
        }
        if (question.choices.some((c) => c.key === raw)) return raw;
        output.write(`Pick 1-${question.choices.length}\n`);
      }
    } finally {
      rl.close();
    }
  };
}
