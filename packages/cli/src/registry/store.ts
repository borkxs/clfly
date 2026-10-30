import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { ClflyError } from "@clfly/core";
import { writeAtomic } from "./io.js";

export const FORMAT_VERSION = 1;

export interface RegistryTree {
  path: string;
  bin: string;
  name: string;
  coreVersion: string;
  manifest: string | null;
  root: string;
  /** Set by `link`. Null when `register` recorded a tree that was never linked. */
  linkedAt: string | null;
  registered: Record<string, string>;
}

export interface RegistryFile {
  formatVersion: 1;
  trees: Record<string, RegistryTree>;
}

export function emptyRegistry(): RegistryFile {
  return { formatVersion: FORMAT_VERSION, trees: {} };
}

export function readRegistry(file: string): RegistryFile {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyRegistry();
    throw new ClflyError(
      `Cannot read ${file}: ${err instanceof Error ? err.message : err}`,
      1,
    );
  }
  let parsed: RegistryFile;
  try {
    parsed = JSON.parse(raw) as RegistryFile;
  } catch (err) {
    throw new ClflyError(
      `${file} is not JSON: ${err instanceof Error ? err.message : err}`,
      1,
    );
  }
  if (parsed?.formatVersion !== FORMAT_VERSION || !parsed.trees || typeof parsed.trees !== "object") {
    throw new ClflyError(`${file} is not a clfly registry (formatVersion 1)`, 1);
  }
  return parsed;
}

export function writeRegistry(file: string, registry: RegistryFile): void {
  mkdirSync(dirname(file), { recursive: true });
  writeAtomic(file, `${JSON.stringify(registry, null, 2)}\n`);
}
