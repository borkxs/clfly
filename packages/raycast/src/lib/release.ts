/**
 * Release-title normalization for search-as-you-type: strip resolution,
 * codec, source, release group, and punctuation. Everything from the first
 * year / season / quality marker on is dropped, which takes the group with
 * it, so `Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.H.265-FLUX` and
 * `Dune - Part Two (2024) [1080p] [YTS]` both group as "Dune Part Two 2024".
 */

export interface NormalizedTitle {
  /** Words before the first year / season / quality marker. */
  title: string;
  year?: string;
  /** `S02`, or `S02E05` for a single episode. */
  season?: string;
  /** Grouping key: lowercased title + year + season. */
  key: string;
  /** Text to complete the query to. */
  completion: string;
}

const QUALITY =
  /^(\d{3,4}p|4k|uhd|hdr|hdr10|dv|sdr|bluray|blu-ray|bdrip|brrip|remux|web|web-?dl|webrip|hdtv|dvdrip|dvd|hdrip|x264|x265|h264|h265|hevc|avc|av1|xvid|aac|ac3|eac3|ddp?\d?|dts|truehd|atmos|10bit|8bit|proper|repack|extended|unrated|internal|multi|imax|amzn|nf|dsnp|hmax|atvp)$/i;
const YEAR = /^(19\d{2}|20\d{2})$/;
const SEASON = /^s(\d{1,2})(?:e(\d{1,3}))?$/i;

export function normalizeReleaseTitle(raw: string): NormalizedTitle {
  const cleaned = raw
    .replace(/\[[^\]]*\]/g, " ") // [YTS], [1080p]
    .replace(/\(([^)]*)\)/g, (_, inner: string) => (YEAR.test(inner.trim()) ? ` ${inner} ` : " "))
    .replace(/[._]+/g, " ")
    .replace(/[^\p{L}\p{N}' -]+/gu, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);

  const title: string[] = [];
  let year: string | undefined;
  let season: string | undefined;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const s = SEASON.exec(w);
    if (s) {
      season = `S${s[1]!.padStart(2, "0")}${s[2] ? `E${s[2].padStart(2, "0")}` : ""}`;
      break;
    }
    if (/^season$/i.test(w) && /^\d{1,2}$/.test(words[i + 1] ?? "")) {
      season = `S${words[i + 1]!.padStart(2, "0")}`;
      break;
    }
    // A year right at the start is part of the title ("2001 A Space Odyssey").
    if (YEAR.test(w) && title.length > 0) {
      year = w;
      // Season markers can follow the year: "Show 2019 S02".
      const next = SEASON.exec(words[i + 1] ?? "");
      if (next) season = `S${next[1]!.padStart(2, "0")}${next[2] ? `E${next[2].padStart(2, "0")}` : ""}`;
      break;
    }
    if (QUALITY.test(w) || /^\d{3,4}p$/i.test(w)) break;
    if (/^-+$/.test(w)) continue; // "Dune - Part Two"
    title.push(w.replace(/-+$/, ""));
  }

  const titleText = title.join(" ").trim();
  const display = titleText
    .split(" ")
    .map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
  const parts = [display, year, season].filter(Boolean) as string[];
  return {
    title: display,
    ...(year ? { year } : {}),
    ...(season ? { season } : {}),
    key: [titleText.toLowerCase(), year ?? "", season ?? ""].join("|"),
    completion: parts.join(" "),
  };
}

export interface Hit {
  title: string;
  seeders?: number;
}

export interface Suggestion<H extends Hit> {
  completion: string;
  normalized: NormalizedTitle;
  count: number;
  /** Highest-seeded hit in the group: the default pick. */
  best: H;
  hits: H[];
}

/**
 * Group hits by normalized title/year/season. The most common group comes
 * first (summed seeders break ties); each group's best hit is the one with
 * the most seeders.
 */
export function suggestCompletions<H extends Hit>(hits: H[], limit = 5): Suggestion<H>[] {
  const groups = new Map<string, Suggestion<H>>();
  for (const hit of hits) {
    const n = normalizeReleaseTitle(hit.title);
    if (!n.title) continue;
    const g = groups.get(n.key);
    if (!g) {
      groups.set(n.key, { completion: n.completion, normalized: n, count: 1, best: hit, hits: [hit] });
      continue;
    }
    g.count++;
    g.hits.push(hit);
    if ((hit.seeders ?? 0) > (g.best.seeders ?? 0)) g.best = hit;
  }
  const seeders = (g: Suggestion<H>) => g.hits.reduce((s, h) => s + (h.seeders ?? 0), 0);
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || seeders(b) - seeders(a))
    .slice(0, limit);
}
