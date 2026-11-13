import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { extractAnswers, INPUT_REQUIRED_EXIT, type AskQuestion } from "../src/ask.js";
import { createCli } from "../src/run.js";

function collect() {
  let data = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      data += String(chunk);
      cb();
    },
  });
  return { stream, text: () => data };
}

// `pick` asks which hit (keyed by hash; ORDER=rev lists them reversed), then
// where to; it returns both answers.
const dir = mkdtempSync(join(tmpdir(), "clfly-ask-"));
writeFileSync(
  join(dir, "pick.ts"),
  `export default async function (_opts, ctx) {
  const hits = [
    { key: "aaa111", label: "Movie 1080p", row: { title: "Movie 1080p", infoHash: "aaa111" } },
    { key: "bbb222", label: "Movie 2160p", row: { title: "Movie 2160p", infoHash: "bbb222" } },
  ];
  if (ctx.env.ORDER === "rev") hits.reverse();
  const hit = await ctx.ask({ key: "hit", message: "Which hit?", choices: hits });
  const dest = await ctx.ask({
    key: "dest",
    message: "Movies or TV?",
    initial: "movie",
    choices: [{ key: "movie", label: "Movies" }, { key: "tv", label: "TV" }],
  });
  ctx.stdout.write("got " + hit + " " + dest + "\\n");
  return { hit, dest };
}
`,
);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function run(
  argv: string[],
  opts: { interactive?: boolean; env?: Record<string, string>; answers?: string[] } = {},
) {
  const out = collect();
  const err = collect();
  const asked: AskQuestion[] = [];
  const replies = [...(opts.answers ?? [])];
  const cli = createCli({
    name: "t",
    commandsDir: dir,
    stdout: out.stream,
    stderr: err.stream,
    env: { ...opts.env },
    interactive: opts.interactive ?? false,
    prompt: async (q) => {
      asked.push(q);
      return replies.shift()!;
    },
  });
  const result = await cli.runUnlogged(argv, out.stream);
  return { result, out: out.text(), err: err.text(), asked };
}

describe("ctx.ask", () => {
  it("on a terminal prompts for each question and runs through", async () => {
    const r = await run(["pick"], { interactive: true, answers: ["bbb222", "tv"] });
    expect(r.result.exitCode).toBe(0);
    expect(r.asked.map((q) => q.key)).toEqual(["hit", "dest"]);
    expect(r.out).toBe("got bbb222 tv\n");
  });

  it("a terminal still takes --answer without prompting for it", async () => {
    const r = await run(["pick", "--answer", "hit=aaa111"], { interactive: true, answers: ["movie"] });
    expect(r.asked.map((q) => q.key)).toEqual(["dest"]);
    expect(r.out).toBe("got aaa111 movie\n");
  });

  it("off a terminal the first run stops at question 1 with an input-required result", async () => {
    const r = await run(["pick"]);
    expect(r.result.exitCode).toBe(INPUT_REQUIRED_EXIT);
    expect(r.result.inputRequired).toEqual({
      resultType: "input_required",
      inputRequests: {
        hit: {
          message: "Which hit?",
          choices: [
            { key: "aaa111", label: "Movie 1080p", row: { title: "Movie 1080p", infoHash: "aaa111" } },
            { key: "bbb222", label: "Movie 2160p", row: { title: "Movie 2160p", infoHash: "bbb222" } },
          ],
        },
      },
      answers: {},
    });
    expect(JSON.parse(r.out)).toEqual(r.result.inputRequired);
    expect(r.err).toContain("--answer hit=<key>");
    expect(r.asked).toEqual([]);
  });

  it("a rerun with answer 1 stops at question 2 and carries the answer", async () => {
    const r = await run(["pick", "--answer", "hit=bbb222"]);
    expect(r.result.exitCode).toBe(INPUT_REQUIRED_EXIT);
    expect(Object.keys(r.result.inputRequired!.inputRequests)).toEqual(["dest"]);
    expect(r.result.inputRequired!.inputRequests.dest!.initial).toBe("movie");
    expect(r.result.inputRequired!.answers).toEqual({ hit: "bbb222" });
  });

  it("a rerun with both answers completes", async () => {
    const r = await run(["pick", "--answer", "hit=bbb222", "--answer=dest=movie", "--json"]);
    expect(r.result.exitCode).toBe(0);
    expect(r.result.value).toEqual({ hit: "bbb222", dest: "movie" });
  });

  it("an answer keys the thing, not its position: reordered choices pick the same hit", async () => {
    const r = await run(["pick", "--answer", "hit=aaa111", "--answer", "dest=tv"], {
      env: { ORDER: "rev" },
    });
    expect(r.result.value).toEqual({ hit: "aaa111", dest: "tv" });
  });

  it("a stale key asks again instead of guessing", async () => {
    const r = await run(["pick", "--answer", "hit=gone999", "--answer", "dest=tv"]);
    expect(r.result.exitCode).toBe(INPUT_REQUIRED_EXIT);
    expect(Object.keys(r.result.inputRequired!.inputRequests)).toEqual(["hit"]);
    const t = await run(["pick", "--answer", "hit=gone999"], { interactive: true, answers: ["aaa111", "movie"] });
    expect(t.asked.map((q) => q.key)).toEqual(["hit", "dest"]);
    expect(t.out).toBe("got aaa111 movie\n");
  });
});

describe("extractAnswers", () => {
  it("pulls both spellings, keeps '=' inside values, leaves the rest", () => {
    expect(extractAnswers(["a", "--answer", "k=v=w", "--answer=x=y", "b"])).toEqual({
      argv: ["a", "b"],
      answers: { k: "v=w", x: "y" },
    });
  });
  it("rejects a pair with no key", () => {
    expect(() => extractAnswers(["--answer", "=v"])).toThrow(/key/);
  });
});
