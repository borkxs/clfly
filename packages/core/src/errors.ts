export class ClflyError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "ClflyError";
    this.exitCode = exitCode;
  }
}

/**
 * Stop a command whose terminal output already said why (a prompt cancel, an
 * outro, a logged error), instead of calling `process.exit`. The CLI run path
 * prints nothing for it and returns `exitCode`; with `--json` a failure still
 * writes `{error:{message}}`, and over MCP a failure is a tool error with
 * `message` while exit 0 (a cancel) is a plain result. `exitCode` 0 is a clean
 * stop. `message` is for those machine channels; the terminal never shows it.
 */
export class ReportedExit extends ClflyError {
  readonly reported = true;

  constructor(exitCode = 1, message?: string) {
    super(
      message || (exitCode === 0 ? "Cancelled." : `Failed (exit ${exitCode}).`),
      exitCode,
    );
    this.name = "ReportedExit";
  }
}

export class ValidationError extends ClflyError {
  readonly issues: ValidationIssue[];
  readonly helpExcerpt?: string;

  constructor(issues: ValidationIssue[], helpExcerpt?: string) {
    const body = issues
      .map((i) => {
        const where = i.path.length ? `--${i.path.join(".")}` : "(args)";
        const expected = i.expected ? ` (expected ${i.expected})` : "";
        return `  ${where}: ${i.message}${expected}`;
      })
      .join("\n");
    const help = helpExcerpt ? `\n\n${helpExcerpt}` : "";
    super(`Invalid arguments:\n${body}${help}`, 2);
    this.name = "ValidationError";
    this.issues = issues;
    this.helpExcerpt = helpExcerpt;
  }
}

export interface ValidationIssue {
  path: PropertyKey[];
  message: string;
  expected?: string;
}

export class ReservedFlagError extends ClflyError {
  constructor(commandPath: string[], flag: string) {
    const cmd = commandPath.join(" ") || "(root)";
    super(
      `Command "${cmd}" defines "${flag}", which is reserved. ` +
        `Remove it from the args schema (reserved: help, version, json, -h, -V).`,
    );
    this.name = "ReservedFlagError";
  }
}

export class ManifestVersionError extends ClflyError {
  constructor(opts: {
    manifestFormat: number;
    expectedFormat: number;
    coreVersion: string;
  }) {
    super(
      `Manifest format ${opts.manifestFormat} is incompatible with @clfly/core ` +
        `(expects format ${opts.expectedFormat}, installed ${opts.coreVersion}). ` +
        `Run \`clfly build\`.`,
    );
    this.name = "ManifestVersionError";
  }
}
