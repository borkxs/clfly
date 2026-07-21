export class ClflyError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "ClflyError";
    this.exitCode = exitCode;
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
    super(`Invalid arguments:\n${body}${help}`);
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
