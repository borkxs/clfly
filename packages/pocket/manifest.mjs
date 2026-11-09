// The trees the page completes against, from `clfly manifest --json`, cached briefly.
// A failed refresh after a good load keeps the trees it had: the page goes on working and
// the failure is reported as `stale` (logged, not shown). Only a cache with no trees at all
// reports `error`, which the page shows in place of the list.

/** Turn a failed `clfly manifest` into something a person can act on. */
export function manifestFailure(bin, res) {
  const raw = res.error ?? "clfly manifest returned no JSON";
  if (/unknown command:?\s*manifest/i.test(raw) || /unknown command:?\s*manifest/i.test(res.stderr ?? "")) {
    return `${bin} has no "manifest" command (an older clfly build). Link a current clfly, or set CLFLY_BIN.`;
  }
  return raw;
}

/**
 * @param {() => Promise<{ code: number, json?: any, error?: string, stderr?: string }>} exec runs `clfly manifest --json`
 * @param {{ bin?: string, ttlMs?: number, now?: () => number }} [opts]
 */
export function manifestCache(exec, { bin = "clfly", ttlMs = 15_000, now = Date.now } = {}) {
  let state = { trees: [], at: 0, error: undefined, stale: undefined };
  return async function load(force = false) {
    if (!force && state.at && now() - state.at < ttlMs) return state;
    const res = await exec();
    if (res.code === 0 && Array.isArray(res.json?.trees)) {
      state = { trees: res.json.trees, at: now(), error: undefined, stale: undefined };
    } else {
      const why = manifestFailure(bin, res);
      state = state.trees.length
        ? { ...state, at: now(), error: undefined, stale: why }
        : { trees: [], at: now(), error: why, stale: undefined };
    }
    return state;
  };
}
