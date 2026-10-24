import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { buildManifest, type FlagInfo, type ManifestRoute, type PositionalInfo } from "@clfly/core";

interface Pkg {
  name?: string;
  description?: string;
  bin?: string | Record<string, string>;
}

export function findCommandsDir(cwd: string): string {
  for (const rel of ["commands", "src/commands"]) {
    const candidate = join(cwd, rel);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`No commands/ or src/commands under ${cwd}`);
}

export function repoRoot(start: string): string {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function loadPkg(cwd: string): Pkg {
  return JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as Pkg;
}

export function serveInvocation(cwd: string, pkg: Pkg = loadPkg(cwd)): {
  skillName: string;
  command: string;
} {
  let skillName: string;
  let binPath: string;
  if (typeof pkg.bin === "string") {
    binPath = pkg.bin;
    skillName = basename(binPath).replace(/\.(mjs|cjs|js|ts)$/, "");
  } else if (pkg.bin && Object.keys(pkg.bin).length > 0) {
    skillName = Object.keys(pkg.bin)[0]!;
    binPath = pkg.bin[skillName]!;
  } else {
    throw new Error(`No bin in ${join(cwd, "package.json")}`);
  }
  const root = repoRoot(cwd);
  const relBin = relative(root, join(cwd, binPath)).split("\\").join("/");
  const relPkgRaw = relative(root, cwd).split("\\").join("/");
  const relPkg = relPkgRaw === "" ? "." : relPkgRaw;
  return {
    skillName,
    command: `node ${relBin} mcp serve --root ${relPkg}`,
  };
}

function flagLine(flag: FlagInfo): string {
  const type =
    flag.enum && flag.enum.length > 0
      ? flag.enum.map((value) => JSON.stringify(value)).join("|")
      : flag.type;
  const presence = flag.optional ? "optional" : "required";
  const def = flag.default !== undefined ? `, default ${JSON.stringify(flag.default)}` : "";
  const desc = flag.description ? ` — ${oneLine(flag.description)}` : "";
  return `\`--${flag.name}\` (${type}, ${presence}${def})${desc}`;
}

function positionalLine(positional: PositionalInfo): string {
  const name = positional.variadic ? `${positional.name}...` : positional.name;
  const form = positional.optional ? `[${name}]` : `<${name}>`;
  const desc = positional.description ? ` — ${oneLine(positional.description)}` : "";
  return `\`${form}\`${desc}`;
}

export function renderSkill(input: {
  skillName: string;
  description: string;
  command: string;
  routes: ManifestRoute[];
}): string {
  const routes = [...input.routes].sort((a, b) => a.path.join("/").localeCompare(b.path.join("/")));
  const lines = [
    "---",
    `name: ${input.skillName}`,
    `description: ${JSON.stringify(oneLine(input.description))}`,
    "---",
    "",
    `# ${input.skillName}`,
    "",
    oneLine(input.description),
    "",
    "## Commands",
  ];
  for (const route of routes) {
    const path = route.path.join("/") || "(root)";
    lines.push(
      "",
      `### ${path}`,
      "",
      oneLine(route.meta?.description ?? ""),
      "",
      "Positionals:",
    );
    if (route.positionals.length === 0) {
      lines.push("- none");
    } else {
      for (const positional of route.positionals) {
        lines.push(`- ${positionalLine(positional)}`);
      }
    }
    lines.push("", "Flags:");
    if (route.flags.length === 0) {
      lines.push("- none");
    } else {
      for (const flag of route.flags) {
        lines.push(`- ${flagLine(flag)}`);
      }
    }
  }
  lines.push("", "## Serve", "", "```", input.command, "```", "");
  return lines.join("\n");
}

/** Write SKILL.md for the tree at `cwd`. Returns the file path. */
export async function exportSkill(options: { cwd: string; outDir?: string }): Promise<string> {
  const pkg = loadPkg(options.cwd);
  const { skillName, command } = serveInvocation(options.cwd, pkg);
  const description = oneLine(pkg.description ?? `${skillName} command tree`);
  const tmp = mkdtempSync(join(tmpdir(), "clfly-skill-"));
  try {
    const built = await buildManifest({
      commandsDir: findCommandsDir(options.cwd),
      outFile: join(tmp, "manifest.js"),
    });
    const body = renderSkill({
      skillName,
      description,
      command,
      routes: built.manifest.routes,
    });
    const outDir = options.outDir ?? join(repoRoot(options.cwd), ".claude", "skills", skillName);
    mkdirSync(outDir, { recursive: true });
    const dest = join(outDir, "SKILL.md");
    writeFileSync(dest, body);
    return dest;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
