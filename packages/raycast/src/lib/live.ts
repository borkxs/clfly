/**
 * Search-as-you-type pacing. The source (pm search → Prowlarr → every
 * indexer) is rate-limited upstream, so per ~/git/_agent-shared/API-CLIENTS.md:
 * debounce keystrokes, keep one run in flight (the newest query waits for
 * it instead of piling on), space launches out, cache by query, and stop
 * after three failures in a row instead of retrying through them.
 */
export interface LivePolicy {
  debounceMs: number;
  /** Minimum gap between launches. */
  spacingMs: number;
  minLength: number;
  maxConsecutiveFailures: number;
}

export const DEFAULT_POLICY: LivePolicy = { debounceMs: 300, spacingMs: 1000, minLength: 3, maxConsecutiveFailures: 3 };

export type LiveState<T> =
  | { status: "idle" }
  | { status: "loading"; query: string; previous?: T }
  | { status: "done"; query: string; value: T }
  | { status: "failed"; query: string; error: string; paused: boolean };

export interface LiveStats {
  launches: number;
  cacheHits: number;
  failures: number;
}

/** Framework-free scheduler; the React hook only forwards text and renders state. */
export class LiveSearcher<T> {
  private cache = new Map<string, T>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;
  private pending: string | undefined;
  private lastLaunch = 0;
  private consecutiveFailures = 0;
  private last: T | undefined;
  readonly stats: LiveStats = { launches: 0, cacheHits: 0, failures: 0 };

  constructor(
    private readonly run: (query: string) => Promise<T>,
    private readonly onState: (state: LiveState<T>) => void,
    private readonly policy: LivePolicy = DEFAULT_POLICY,
    private readonly now: () => number = Date.now,
  ) {}

  get paused(): boolean {
    return this.consecutiveFailures >= this.policy.maxConsecutiveFailures;
  }

  /** Called on every keystroke. */
  type(text: string): void {
    clearTimeout(this.timer);
    const query = normalizeQuery(text);
    if (query.length < this.policy.minLength) {
      this.pending = undefined;
      this.onState({ status: "idle" });
      return;
    }
    const hit = this.cache.get(query);
    if (hit !== undefined) {
      this.stats.cacheHits++;
      this.pending = undefined;
      this.last = hit;
      this.onState({ status: "done", query, value: hit });
      return;
    }
    if (this.paused) return;
    this.timer = setTimeout(() => this.request(query), this.policy.debounceMs);
  }

  /** Explicit submit (Enter): runs now, and clears a pause. */
  submit(text: string): void {
    clearTimeout(this.timer);
    this.consecutiveFailures = 0;
    const query = normalizeQuery(text);
    if (query) this.request(query, true);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.pending = undefined;
  }

  private request(query: string, force = false): void {
    if (!force && this.cache.has(query)) return this.type(query);
    this.pending = query;
    if (this.inFlight) return; // picked up when the current run finishes
    const wait = this.lastLaunch + this.policy.spacingMs - this.now();
    if (wait > 0) {
      this.timer = setTimeout(() => this.drain(), wait);
      return;
    }
    this.drain();
  }

  private drain(): void {
    const query = this.pending;
    if (query === undefined || this.inFlight || this.paused) return;
    this.pending = undefined;
    this.inFlight = true;
    this.lastLaunch = this.now();
    this.stats.launches++;
    this.onState({ status: "loading", query, previous: this.last });
    this.run(query).then(
      (value) => {
        this.consecutiveFailures = 0;
        this.cache.set(query, value);
        this.last = value;
        this.finish(() => this.onState({ status: "done", query, value }));
      },
      (err: unknown) => {
        this.consecutiveFailures++;
        this.stats.failures++;
        const error = err instanceof Error ? err.message : String(err);
        this.finish(() => this.onState({ status: "failed", query, error, paused: this.paused }));
      },
    );
  }

  private finish(report: () => void): void {
    this.inFlight = false;
    // A newer query is waiting: run it instead of flashing the stale result.
    if (this.pending !== undefined && !this.paused) return this.request(this.pending);
    report();
  }
}

export function normalizeQuery(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}
