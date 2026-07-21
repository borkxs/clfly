import type { ValidationIssue } from "../errors.js";

export interface JsonErrorBody {
  error: {
    message: string;
    issues?: Array<{ path: PropertyKey[]; message: string; expected?: string }>;
  };
}

/** Write success payload for `--json` mode (bare data, pretty-printed). */
export function writeJsonResult(
  stdout: NodeJS.WritableStream,
  value: unknown,
): void {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Write error payload for `--json` mode to stderr. */
export function writeJsonError(
  stderr: NodeJS.WritableStream,
  message: string,
  issues?: ValidationIssue[],
): void {
  const body: JsonErrorBody = {
    error: {
      message,
      ...(issues
        ? {
            issues: issues.map((i) => ({
              path: i.path,
              message: i.message,
              ...(i.expected ? { expected: i.expected } : {}),
            })),
          }
        : {}),
    },
  };
  stderr.write(`${JSON.stringify(body, null, 2)}\n`);
}
