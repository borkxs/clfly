import type { FlagInfo, Meta } from "../types.js";

export interface HelpOptions {
  name: string;
  commandPath: string[];
  meta?: Meta;
  flags: FlagInfo[];
  pathParamNames: string[];
  subcommands?: Array<{ name: string; description?: string }>;
}

export function renderHelp(opts: HelpOptions): string {
  const full = [opts.name, ...opts.commandPath.filter((p) => !p.startsWith("<"))]
    .join(" ")
    .trim();
  const usageParts = [opts.name, ...opts.commandPath];
  for (const p of opts.pathParamNames) {
    if (!opts.commandPath.some((c) => c === `<${p}>`)) {
      usageParts.push(`<${p}>`);
    }
  }
  if (opts.subcommands && opts.subcommands.length > 0) {
    usageParts.push("<command>");
  }
  usageParts.push("[options]");

  const lines: string[] = [];
  lines.push(`Usage: ${usageParts.join(" ")}`);
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
    const width = Math.max(...opts.subcommands.map((s) => s.name.length), 4);
    for (const sub of opts.subcommands) {
      const desc = sub.description ? `  ${sub.description}` : "";
      lines.push(`  ${sub.name.padEnd(width)}${desc}`);
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

  void full;
  return lines.join("\n") + "\n";
}

function formatFlagLabel(f: FlagInfo): string {
  const long = f.type === "boolean" ? `--${f.name}` : `--${f.name} <value>`;
  if (f.alias) return `-${f.alias}, ${long}`;
  return `    ${long}`;
}

/** Short excerpt used under validation errors. */
export function renderHelpExcerpt(opts: HelpOptions): string {
  if (opts.flags.length === 0) return renderHelp(opts).trimEnd();
  const lines = ["Options:"];
  for (const f of opts.flags) {
    const label = formatFlagLabel(f);
    lines.push(`  ${label}  ${f.description ?? ""}`.trimEnd());
  }
  return lines.join("\n");
}
