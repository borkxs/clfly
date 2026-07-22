import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type ValidatorKind = "zod" | "valibot" | "arktype";

export function detectPackageManager(
  cwd: string,
  ctx?: { env?: NodeJS.ProcessEnv },
): PackageManager {
  const env = ctx?.env ?? process.env;
  const ua = env.npm_config_user_agent ?? "";
  if (ua.includes("pnpm")) return "pnpm";
  if (ua.includes("yarn")) return "yarn";
  if (ua.includes("bun")) return "bun";

  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) {
    return "bun";
  }
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  return "npm";
}

export function readProjectValidator(cwd: string): ValidatorKind {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return "zod";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      clfly?: { validator?: string };
    };
    const v = pkg.clfly?.validator;
    if (v === "zod" || v === "valibot" || v === "arktype") return v;
  } catch {
    /* fallthrough */
  }
  return "zod";
}
