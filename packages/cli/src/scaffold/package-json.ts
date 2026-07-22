import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ValidatorKind } from "./detect.js";

export interface PackageJsonMergeResult {
  wrote: boolean;
  skippedFile: boolean;
  added: string[];
  skipped: string[];
  suggested: string[];
}

const VALIDATOR_DEP: Record<ValidatorKind, { name: string; range: string }> = {
  zod: { name: "zod", range: "^4" },
  valibot: { name: "valibot", range: "^1" },
  arktype: { name: "arktype", range: "^2" },
};

export function mergePackageJson(opts: {
  targetDir: string;
  cliName: string;
  validator: ValidatorKind;
  force: boolean;
}): PackageJsonMergeResult {
  const pkgPath = join(opts.targetDir, "package.json");
  const suggested = [
    `"start": "tsx bin/${opts.cliName}.ts"`,
    `"typecheck": "tsc -p tsconfig.json --noEmit"`,
  ];

  if (!existsSync(pkgPath)) {
    const fresh = {
      name: opts.cliName,
      version: "0.0.0",
      private: true,
      type: "module",
      bin: { [opts.cliName]: `./bin/${opts.cliName}.ts` },
      scripts: {
        start: `tsx bin/${opts.cliName}.ts`,
        typecheck: "tsc -p tsconfig.json --noEmit",
      },
      dependencies: {
        "@clfly/core": "^0.1.0",
        [VALIDATOR_DEP[opts.validator].name]: VALIDATOR_DEP[opts.validator].range,
      },
      devDependencies: {
        "@types/node": "^22",
        tsx: "^4",
        typescript: "^5",
      },
      clfly: { validator: opts.validator },
      engines: { node: ">=20" },
    };
    writeFileSync(pkgPath, `${JSON.stringify(fresh, null, 2)}\n`, "utf8");
    return {
      wrote: true,
      skippedFile: false,
      added: ["(new package.json)"],
      skipped: [],
      suggested: [],
    };
  }

  // Existing package.json — non-destructive merge only.
  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  const added: string[] = [];
  const skipped: string[] = [];

  if (pkg.type === undefined) {
    pkg.type = "module";
    added.push("type");
  } else {
    skipped.push("type");
  }

  const bin =
    typeof pkg.bin === "object" && pkg.bin !== null && !Array.isArray(pkg.bin)
      ? ({ ...(pkg.bin as Record<string, string>) } as Record<string, string>)
      : {};
  const binKey = opts.cliName;
  if (bin[binKey] === undefined) {
    bin[binKey] = `./bin/${opts.cliName}.ts`;
    pkg.bin = bin;
    added.push(`bin.${binKey}`);
  } else {
    skipped.push(`bin.${binKey}`);
  }

  const deps =
    typeof pkg.dependencies === "object" && pkg.dependencies !== null
      ? { ...(pkg.dependencies as Record<string, string>) }
      : {};
  if (deps["@clfly/core"] === undefined) {
    deps["@clfly/core"] = "^0.1.0";
    added.push("dependencies.@clfly/core");
  } else {
    skipped.push("dependencies.@clfly/core");
  }
  const vDep = VALIDATOR_DEP[opts.validator];
  if (deps[vDep.name] === undefined) {
    deps[vDep.name] = vDep.range;
    added.push(`dependencies.${vDep.name}`);
  } else {
    skipped.push(`dependencies.${vDep.name}`);
  }
  pkg.dependencies = deps;

  const clfly =
    typeof pkg.clfly === "object" && pkg.clfly !== null
      ? { ...(pkg.clfly as Record<string, unknown>) }
      : {};
  if (clfly.validator === undefined) {
    clfly.validator = opts.validator;
    pkg.clfly = clfly;
    added.push("clfly.validator");
  } else {
    skipped.push("clfly.validator");
  }

  const scripts =
    typeof pkg.scripts === "object" && pkg.scripts !== null
      ? (pkg.scripts as Record<string, string>)
      : {};
  for (const [k, v] of Object.entries({
    start: `tsx bin/${opts.cliName}.ts`,
    typecheck: "tsc -p tsconfig.json --noEmit",
  })) {
    if (scripts[k] === undefined) {
      // Still don't auto-write scripts into existing projects — suggest only.
      suggested.push(`"${k}": "${v}"`);
    } else {
      skipped.push(`scripts.${k}`);
    }
  }

  if (added.length > 0) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    return {
      wrote: true,
      skippedFile: false,
      added,
      skipped,
      suggested,
    };
  }

  return {
    wrote: false,
    skippedFile: true,
    added,
    skipped,
    suggested,
  };
}
