/** Edit distance (internal — no dependency). */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[m]![n]!;
}

/**
 * Nearest candidate within `maxDistance` (default 2).
 * Prefers shorter distance, then shorter name, then lexicographic.
 */
export function nearestMatch(
  needle: string,
  candidates: Iterable<string>,
  maxDistance = 2,
): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const name of candidates) {
    const d = levenshtein(needle, name);
    if (d > maxDistance || d > bestDist) continue;
    if (
      d < bestDist ||
      (best !== undefined &&
        (name.length < best.length ||
          (name.length === best.length && name < best)))
    ) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}
