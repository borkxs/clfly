import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Context } from "@clfly/core";
import { ClflyError } from "@clfly/core";
import {
  detectPackageManager,
  type PackageManager,
  type ValidatorKind,
} from "./detect.js";
import { mergePackageJson, type PackageJsonMergeResult } from "./package-json.js";
import { renderBin, renderHello, renderIndex, renderReadme, renderTsconfig } from "./template.js";

export interface InitOptions {
  name?: string;
  validator?: ValidatorKind;
  pm?: PackageManager;
  force?: boolean;
}

export interface InitResult {
  created: string[];
  skipped: string[];
  targetDir: string;
  packageJson?: PackageJsonMergeResult;
}

export async function runInit(
  opts: InitOptions,
  ctx: Pick<Context, "cwd" | "stdout" | "stderr" | "json">,
): Promise<InitResult> {
  const validator: ValidatorKind = opts.validator ?? "zod";
  const pm: PackageManager =
    opts.pm ?? detectPackageManager(ctx.cwd, { env: process.env });
  const force = opts.force ?? false;
  const cliName = opts.name ?? inferCliName(ctx.cwd);
  const targetDir = opts.name ? resolve(ctx.cwd, opts.name) : resolve(ctx.cwd);

  if (!force && isNonEmptyDir(targetDir)) {
    throw new ClflyError(
      `Target directory is not empty: ${targetDir}\n` +
        `Pass --force to retrofit (writes only missing files; never overwrites).`,
      2,
    );
  }

  mkdirSync(targetDir, { recursive: true });

  const planned: Array<{ rel: string; contents: string }> = [
    {
      rel: "package.json",
      contents: "", // handled specially
    },
    {
      rel: "tsconfig.json",
      contents: renderTsconfig(),
    },
    {
      rel: "README.md",
      contents: renderReadme(cliName),
    },
    {
      rel: join("bin", `${cliName}.ts`),
      contents: renderBin(cliName),
    },
    {
      rel: join("commands", "index.ts"),
      contents: renderIndex(cliName),
    },
    {
      rel: join("commands", "hello.ts"),
      contents: renderHello(validator),
    },
  ];

  const created: string[] = [];
  const skipped: string[] = [];
  let packageJson: PackageJsonMergeResult | undefined;

  for (const file of planned) {
    const abs = join(targetDir, file.rel);
    if (file.rel === "package.json") {
      const result = mergePackageJson({
        targetDir,
        cliName,
        validator,
        force,
      });
      packageJson = result;
      if (result.wrote) created.push(toRepoRel(ctx.cwd, abs));
      else if (result.skippedFile) skipped.push(toRepoRel(ctx.cwd, abs));
      continue;
    }

    if (existsSync(abs)) {
      skipped.push(toRepoRel(ctx.cwd, abs));
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.contents, "utf8");
    created.push(toRepoRel(ctx.cwd, abs));
  }

  if (!ctx.json) {
    for (const p of created) ctx.stdout.write(`${p}\n`);
    for (const p of skipped) {
      ctx.stderr.write(`skipped (exists): ${p}\n`);
    }
    if (packageJson?.suggested.length) {
      ctx.stderr.write(`Suggested package.json scripts:\n`);
      for (const line of packageJson.suggested) {
        ctx.stderr.write(`  ${line}\n`);
      }
    }
    if (packageJson?.added.length) {
      ctx.stderr.write(`Updated package.json keys: ${packageJson.added.join(", ")}\n`);
    }
    ctx.stderr.write(
      `Next: cd ${relative(ctx.cwd, targetDir) || "."} && ${pm} install\n`,
    );
  }

  return { created, skipped, targetDir, packageJson };
}

function inferCliName(cwd: string): string {
  const base = cwd.replace(/\\/g, "/").split("/").filter(Boolean).at(-1);
  return sanitizeName(base ?? "mycli");
}

function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "mycli";
}

function isNonEmptyDir(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return true;
  }
}

function toRepoRel(cwd: string, abs: string): string {
  const rel = relative(cwd, abs).replace(/\\/g, "/");
  return rel || abs;
}
