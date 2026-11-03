import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveSearcher, type LiveState } from "../src/lib/live";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(run: (q: string) => Promise<string>) {
  const states: LiveState<string>[] = [];
  const s = new LiveSearcher(run, (st) => states.push(st), undefined, () => Date.now());
  return { s, states, last: () => states[states.length - 1] };
}

describe("LiveSearcher", () => {
  it("debounces keystrokes into one run and caches it", async () => {
    const run = vi.fn(async (q: string) => `r:${q}`);
    const { s, last } = setup(run);
    for (const t of ["d", "du", "dun", "dune"]) s.type(t);
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("dune");
    expect(last()).toEqual({ status: "done", query: "dune", value: "r:dune" });
    s.type("Dune ");
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.stats.cacheHits).toBe(1);
  });

  it("keeps one run in flight and runs only the newest query after it", async () => {
    let release!: () => void;
    const run = vi.fn((q: string) => (q === "dune" ? new Promise<string>((r) => (release = () => r("first"))) : Promise.resolve(`r:${q}`)));
    const { s, last } = setup(run);
    s.type("dune");
    await vi.advanceTimersByTimeAsync(300);
    s.type("dune p");
    await vi.advanceTimersByTimeAsync(300);
    s.type("dune part");
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run.mock.calls.map((c) => c[0])).toEqual(["dune", "dune part"]);
    expect(last()).toMatchObject({ status: "done", query: "dune part" });
  });

  it("spaces launches at least a second apart", async () => {
    const run = vi.fn(async (q: string) => q);
    const { s } = setup(run);
    s.type("abc");
    await vi.advanceTimersByTimeAsync(300);
    s.type("abcd");
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
    // First launch at 300 ms, so the second waits until 1300 ms.
    await vi.advanceTimersByTimeAsync(600);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("pauses after three failures in a row until an explicit submit", async () => {
    const run = vi.fn(async () => {
      throw new Error("429");
    });
    const { s, last } = setup(run);
    for (const q of ["aaa", "bbb", "ccc", "ddd"]) {
      s.type(q);
      await vi.advanceTimersByTimeAsync(1500);
    }
    expect(run).toHaveBeenCalledTimes(3);
    expect(last()).toMatchObject({ status: "failed", paused: true });
    s.submit("ddd");
    await vi.advanceTimersByTimeAsync(1500);
    expect(run).toHaveBeenCalledTimes(4);
  });
});
