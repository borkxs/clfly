import { homedir } from "node:os";
import { join } from "node:path";

export function userHome(env: NodeJS.ProcessEnv): string {
  if (env.HOME?.trim()) return env.HOME;
  if (env.USERPROFILE?.trim()) return env.USERPROFILE;
  return homedir();
}

/** Directory that contains `registry.json`. */
export function configHome(env: NodeJS.ProcessEnv): string {
  if (env.CLFLY_HOME?.trim()) return env.CLFLY_HOME;
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg || join(userHome(env), ".config");
  return join(base, "clfly");
}

export function registryPath(env: NodeJS.ProcessEnv): string {
  return join(configHome(env), "registry.json");
}
