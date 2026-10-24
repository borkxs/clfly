import { watch, type FSWatcher } from "node:fs";

/** Coalesce add/remove/rename bursts before rebuilding the tool list. */
export const WATCH_DEBOUNCE_MS = 200;

const COMMAND_FILE = /\.(tsx|ts|mts|cts|jsx|js|mjs|cjs)$/;

/**
 * Watch a commands directory. Fires `onChange` after add/remove/rename of a
 * command file. Content edits do not fire. Returns a disposer.
 */
export function watchCommandTree(
  dir: string,
  onChange: () => void | Promise<void>,
  debounceMs = WATCH_DEBOUNCE_MS,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending = false;

  const fire = () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    Promise.resolve(onChange()).finally(() => {
      running = false;
      if (pending) {
        pending = false;
        fire();
      }
    });
  };

  const watcher: FSWatcher = watch(dir, { recursive: true }, (event, filename) => {
    if (event !== "rename") return;
    if (filename == null) return;
    const name = filename.toString();
    if (name.endsWith(".d.ts")) return;
    if (!COMMAND_FILE.test(name)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fire();
    }, debounceMs);
  });

  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
