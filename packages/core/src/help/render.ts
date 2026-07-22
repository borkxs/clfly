import type { FlagInfo, Meta, PositionalInfo } from "../types.js";

export interface HelpOptions {
  name: string;
  commandPath: string[];
  meta?: Meta;
  flags: FlagInfo[];
  /** Path params + `positionals` export — never listed under Options. */
  positionals: PositionalInfo[];
  subcommands?: Array<{ name: string; description?: string }>;
}

export function renderHelp(opts: HelpOptions): string {
  const lines: string[] = [];
  lines.push(`Usage: ${buildUsageLine(opts)}`);
  lines.push("");

  if (opts.meta?.deprecated) {
    const reason =
      typeof opts.meta.deprecated === "string"
        ? ` — ${opts.meta.deprecated}`
        : "";
    lines.push(`DEPRECATED${reason}`);
    lines.push("");
  }

  if (opts.meta?.description) {
    lines.push(opts.meta.description);
    lines.push("");
  }

  if (opts.subcommands && opts.subcommands.length > 0) {
    lines.push("Commands:");
    const withDesc = opts.subcommands.some((s) => s.description);
    const width = Math.max(...opts.subcommands.map((s) => s.name.length), 4);
    for (const sub of opts.subcommands) {
      if (withDesc) {
        const desc = sub.description ? `  ${sub.description}` : "";
        lines.push(`  ${sub.name.padEnd(width)}${desc}`.trimEnd());
      } else {
        lines.push(`  ${sub.name}`);
      }
    }
    lines.push("");
  }

  if (opts.positionals.length > 0) {
    lines.push("Arguments:");
    const argWidth = Math.max(
      ...opts.positionals.map((p) => formatPositionalLabel(p).length),
      4,
    );
    for (const p of opts.positionals) {
      const label = formatPositionalLabel(p).padEnd(argWidth);
      const bits: string[] = [];
      if (p.description) bits.push(p.description);
      if (p.alsoFlag) bits.push(`(also --${p.name})`);
      lines.push(`  ${label}  ${bits.join(" ")}`.trimEnd());
    }
    lines.push("");
  }

  lines.push("Options:");
  const allFlags: FlagInfo[] = [
    ...opts.flags,
    {
      name: "help",
      type: "boolean",
      description: "Show help",
      optional: true,
      alias: "h",
    },
    {
      name: "version",
      type: "boolean",
      description: "Show version",
      optional: true,
      alias: "V",
    },
    {
      name: "json",
      type: "boolean",
      description: "Emit JSON",
      optional: true,
    },
  ];

  const flagWidth = Math.max(
    ...allFlags.map((f) => formatFlagLabel(f).length),
    8,
  );
  for (const f of allFlags) {
    const label = formatFlagLabel(f).padEnd(flagWidth);
    const bits: string[] = [];
    if (f.description) bits.push(f.description);
    if (f.enum) bits.push(`(${f.enum.map(String).join("|")})`);
    if (f.default !== undefined) bits.push(`[default: ${String(f.default)}]`);
    if (f.deprecated) bits.push("DEPRECATED");
    lines.push(`  ${label}  ${bits.join(" ")}`.trimEnd());
  }

  return lines.join("\n") + "\n";
}

/** Short excerpt used under validation errors. */
export function renderHelpExcerpt(opts: HelpOptions): string {
  const lines: string[] = [];
  if (opts.positionals.length > 0) {
    lines.push("Arguments:");
    for (const p of opts.positionals) {
      const label = formatPositionalLabel(p);
      const bits: string[] = [];
      if (p.description) bits.push(p.description);
      if (p.alsoFlag) bits.push(`(also --${p.name})`);
      lines.push(`  ${label}  ${bits.join(" ")}`.trimEnd());
    }
  }
  if (opts.flags.length > 0) {
    if (lines.length) lines.push("");
    lines.push("Options:");
    for (const f of opts.flags) {
      const label = formatFlagLabel(f);
      lines.push(`  ${label}  ${f.description ?? ""}`.trimEnd());
    }
  }
  if (lines.length === 0) return renderHelp(opts).trimEnd();
  return lines.join("\n");
}

function buildUsageLine(opts: HelpOptions): string {
  const parts: string[] = [opts.name];

  // Static / already-rendered path segments (resolve embeds `<param>` for path params).
  for (const seg of opts.commandPath) {
    parts.push(seg);
  }

  // Path params missing from commandPath (e.g. help before a dynamic is filled).
  for (const p of opts.positionals) {
    if (p.source !== "path") continue;
    const marker = formatPositionalToken(p);
    if (!opts.commandPath.some((c) => c === `<${p.name}>` || c === marker)) {
      parts.push(marker);
    }
  }

  // Export positionals always append after the command path.
  for (const p of opts.positionals) {
    if (p.source === "export") parts.push(formatPositionalToken(p));
  }

  if (opts.subcommands && opts.subcommands.length > 0) {
    parts.push("<command>");
  }
  parts.push("[options]");
  return parts.join(" ");
}

/** Synopsis token: `<name>`, `[name]`, `<name...>`, `[name...]`. */
export function formatPositionalToken(p: PositionalInfo): string {
  const body = p.variadic ? `${p.name}...` : p.name;
  return p.optional ? `[${body}]` : `<${body}>`;
}

function formatPositionalLabel(p: PositionalInfo): string {
  return formatPositionalToken(p);
}

function formatFlagLabel(f: FlagInfo): string {
  const long = f.type === "boolean" ? `--${f.name}` : `--${f.name} <value>`;
  if (f.alias) return `-${f.alias}, ${long}`;
  return `    ${long}`;
}
