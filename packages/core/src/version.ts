import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_FORMAT_VERSION, type Manifest } from "./types.js";
import { ManifestVersionError } from "./errors.js";

/** Assert a loaded manifest matches this runtime. Call from the M2 loader. */
export function assertManifestCompatible(
  manifest: Manifest,
  coreVersion: string,
): void {
  if (manifest.formatVersion !== MANIFEST_FORMAT_VERSION) {
    throw new ManifestVersionError({
      manifestFormat: manifest.formatVersion,
      expectedFormat: MANIFEST_FORMAT_VERSION,
      coreVersion,
    });
  }
}

export function coreMajorFromVersion(version: string): number {
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  return Number.isFinite(major) ? major : 0;
}

/** Resolve a version string from package.json, walking up from `fromDir`. */
export function resolvePackageVersion(
  fromDir: string,
  explicitPath?: string,
): string {
  if (explicitPath) {
    return readPackageVersion(explicitPath);
  }
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "package.json");
    try {
      return readPackageVersion(candidate);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return "0.0.0";
}

function readPackageVersion(path: string): string {
  const raw = readFileSync(path, "utf8");
  const pkg = JSON.parse(raw) as { version?: string };
  if (!pkg.version) throw new Error(`No version in ${path}`);
  return pkg.version;
}

export function fileUrlToPath(urlOrPath: string | URL): string {
  if (typeof urlOrPath === "string" && !urlOrPath.startsWith("file:")) {
    return urlOrPath;
  }
  return fileURLToPath(urlOrPath);
}
