import type { CompletionShell, FlagInfo, Manifest } from "../types.js";
import { completionIndexFromManifest, type CompletionCommand } from "../manifest/load.js";
import { ClflyError } from "../errors.js";

export interface GenerateCompletionsOptions {
  name: string;
  manifest: Manifest;
  shell: CompletionShell;
}

export function generateCompletions(options: GenerateCompletionsOptions): string {
  const index = completionIndexFromManifest(options.manifest);
  switch (options.shell) {
    case "bash":
      return renderBash(options.name, index);
    case "zsh":
      return renderZsh(options.name, index);
    case "fish":
      return renderFish(options.name, index);
    default:
      throw new ClflyError(`Unknown shell: ${options.shell as string}`);
  }
}

function renderBash(name: string, commands: CompletionCommand[]): string {
  const staticRoots = rootStatics(commands);
  const lines: string[] = [
    `# clfly bash completion for ${name}`,
    `_${name}_clfly() {`,
    `  local cur prev words cword`,
    `  cur="\${COMP_WORDS[COMP_CWORD]}"`,
    `  prev="\${COMP_WORDS[COMP_CWORD-1]}"`,
    `  words=("\${COMP_WORDS[@]}")`,
    `  cword=$COMP_CWORD`,
    ``,
    `  # Global flags`,
    `  if [[ "$cur" == -* ]]; then`,
    `    COMPREPLY=( $(compgen -W "--help --version --json -h -V" -- "$cur") )`,
    `    return`,
    `  fi`,
    ``,
    `  case "\${words[1]}" in`,
  ];

  const byRoot = groupByRoot(commands);
  for (const [root, cmds] of byRoot) {
    if (root.startsWith(":")) continue;
    lines.push(`    ${root})`);
    lines.push(`      _${name}_clfly_${root.replace(/[^a-zA-Z0-9_]/g, "_")} ;;`);
  }
  lines.push(`    *)`);
  lines.push(
    `      COMPREPLY=( $(compgen -W "${staticRoots.join(" ")}" -- "$cur") ) ;;`,
  );
  lines.push(`  esac`);
  lines.push(`}`);
  lines.push(``);

  for (const [root, cmds] of byRoot) {
    if (root.startsWith(":")) continue;
    const fn = `_${name}_clfly_${root.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    lines.push(`${fn}() {`);
    lines.push(`  local cur="\${COMP_WORDS[COMP_CWORD]}"`);
    const next = nextStatics(cmds, 1);
    const flags = uniqueFlags(cmds.filter((c) => c.rawPath[0] === root));
    lines.push(`  if [[ "$cur" == -* ]]; then`);
    lines.push(
      `    COMPREPLY=( $(compgen -W "${flagWords(flags)}" -- "$cur") )`,
    );
    lines.push(`    return`);
    lines.push(`  fi`);
    if (next.length) {
      lines.push(
        `  COMPREPLY=( $(compgen -W "${next.join(" ")}" -- "$cur") )`,
      );
    } else {
      lines.push(`  COMPREPLY=()`);
    }
    lines.push(`}`);
    lines.push(``);
  }

  lines.push(`complete -F _${name}_clfly ${name}`);
  lines.push(``);
  return lines.join("\n");
}

function renderZsh(name: string, commands: CompletionCommand[]): string {
  const staticRoots = rootStatics(commands);
  const lines: string[] = [
    `#compdef ${name}`,
    `# clfly zsh completion for ${name}`,
    ``,
    `_${name}_clfly() {`,
    `  local -a commands flags`,
    `  commands=(`,
  ];
  for (const root of staticRoots) {
    const desc =
      commands.find((c) => c.rawPath[0] === root)?.description ?? root;
    lines.push(`    '${root}:${escapeZsh(desc)}'`);
  }
  lines.push(`  )`);
  lines.push(`  flags=(`);
  lines.push(`    '--help[Show help]'`);
  lines.push(`    '--version[Show version]'`);
  lines.push(`    '--json[Emit JSON]'`);
  lines.push(`    '-h[Show help]'`);
  lines.push(`    '-V[Show version]'`);
  lines.push(`  )`);
  lines.push(``);
  lines.push(`  _arguments -C \\`);
  lines.push(`    '1:command:->cmds' \\`);
  lines.push(`    '*::arg:->args' \\`);
  lines.push(`    $flags`);
  lines.push(``);
  lines.push(`  case $state in`);
  lines.push(`    cmds) _describe -t commands 'command' commands ;;`);
  lines.push(`    args)`);
  lines.push(`      case $words[1] in`);

  const byRoot = groupByRoot(commands);
  for (const [root, cmds] of byRoot) {
    if (root.startsWith(":")) continue;
    const next = nextStatics(cmds, 1);
    const flags = uniqueFlags(cmds);
    lines.push(`        ${root})`);
    if (next.length) {
      lines.push(`          local -a sub=(${next.map((s) => `'${s}'`).join(" ")})`);
      lines.push(`          _describe -t commands 'subcommand' sub`);
    }
    for (const f of flags) {
      const desc = escapeZsh(f.description ?? f.name);
      if (f.type === "boolean") {
        lines.push(`          _arguments '--${f.name}[${desc}]'`);
      } else if (f.enum?.length) {
        lines.push(
          `          _arguments '--${f.name}[${desc}]:value:(${f.enum.map(String).join(" ")})'`,
        );
      } else {
        lines.push(`          _arguments '--${f.name}[${desc}]:value:'`);
      }
    }
    lines.push(`          ;;`);
  }

  lines.push(`      esac`);
  lines.push(`      ;;`);
  lines.push(`  esac`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`_${name}_clfly "$@"`);
  lines.push(``);
  return lines.join("\n");
}

function renderFish(name: string, commands: CompletionCommand[]): string {
  const lines: string[] = [`# clfly fish completion for ${name}`, ``];
  lines.push(`complete -c ${name} -f`);
  lines.push(
    `complete -c ${name} -s h -l help -d 'Show help'`,
  );
  lines.push(
    `complete -c ${name} -s V -l version -d 'Show version'`,
  );
  lines.push(`complete -c ${name} -l json -d 'Emit JSON'`);

  const staticRoots = rootStatics(commands);
  for (const root of staticRoots) {
    const desc =
      commands.find((c) => c.rawPath[0] === root)?.description ?? root;
    lines.push(
      `complete -c ${name} -n __fish_use_subcommand -a ${root} -d '${escapeFish(desc)}'`,
    );
  }

  for (const cmd of commands) {
    const staticParts = cmd.rawPath.filter((p) => !p.startsWith(":"));
    if (staticParts.length < 2) {
      for (const f of cmd.flags) {
        lines.push(fishFlag(name, f, conditionFor(staticParts)));
      }
      continue;
    }
    const parent = staticParts[0]!;
    const sub = staticParts[1]!;
    lines.push(
      `complete -c ${name} -n '__fish_seen_subcommand_from ${parent}' -a ${sub} -d '${escapeFish(cmd.description ?? sub)}'`,
    );
    for (const f of cmd.flags) {
      lines.push(
        fishFlag(
          name,
          f,
          `'__fish_seen_subcommand_from ${parent}; and __fish_seen_subcommand_from ${sub}'`,
        ),
      );
    }
  }

  lines.push(``);
  return lines.join("\n");
}

function fishFlag(name: string, f: FlagInfo, condition: string): string {
  const d = escapeFish(f.description ?? f.name);
  if (f.type === "boolean") {
    return `complete -c ${name} -n ${condition} -l ${f.name} -d '${d}'`;
  }
  if (f.enum?.length) {
    return `complete -c ${name} -n ${condition} -l ${f.name} -d '${d}' -xa '${f.enum.map(String).join(" ")}'`;
  }
  return `complete -c ${name} -n ${condition} -l ${f.name} -d '${d}' -r`;
}

function conditionFor(staticParts: string[]): string {
  if (staticParts.length === 0) return `__fish_use_subcommand`;
  if (staticParts.length === 1) {
    return `'__fish_seen_subcommand_from ${staticParts[0]}'`;
  }
  return `'__fish_seen_subcommand_from ${staticParts[0]}; and __fish_seen_subcommand_from ${staticParts[1]}'`;
}

function rootStatics(commands: CompletionCommand[]): string[] {
  const set = new Set<string>();
  for (const c of commands) {
    const root = c.rawPath[0];
    if (root && !root.startsWith(":")) set.add(root);
  }
  return [...set].sort();
}

function groupByRoot(
  commands: CompletionCommand[],
): Map<string, CompletionCommand[]> {
  const map = new Map<string, CompletionCommand[]>();
  for (const c of commands) {
    const root = c.rawPath[0];
    if (!root) continue;
    const list = map.get(root) ?? [];
    list.push(c);
    map.set(root, list);
  }
  return map;
}

function nextStatics(commands: CompletionCommand[], depth: number): string[] {
  const set = new Set<string>();
  for (const c of commands) {
    const part = c.rawPath[depth];
    if (part && !part.startsWith(":")) set.add(part);
  }
  return [...set].sort();
}

function uniqueFlags(commands: CompletionCommand[]): FlagInfo[] {
  const map = new Map<string, FlagInfo>();
  for (const c of commands) {
    for (const f of c.flags) map.set(f.name, f);
  }
  return [...map.values()];
}

function flagWords(flags: FlagInfo[]): string {
  const words = ["--help", "--version", "--json", "-h", "-V"];
  for (const f of flags) {
    words.push(`--${f.name}`);
    if (f.alias) words.push(`-${f.alias}`);
  }
  return words.join(" ");
}

function escapeZsh(s: string): string {
  return s.replace(/'/g, `'"'"'`);
}

function escapeFish(s: string): string {
  return s.replace(/'/g, `\\'`);
}
