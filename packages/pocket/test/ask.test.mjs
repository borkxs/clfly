import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { runStatus } from "../run-status.mjs";

// A run that stopped at a question (core ctx.ask off a terminal): the picker's pure side.
const here = dirname(fileURLToPath(import.meta.url));
let m;
before(async () => {
  const out = join(mkdtempSync(join(tmpdir(), "pocket-ask-")), "ask.mjs");
  await build({ entryPoints: [join(here, "../src/ask.ts")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent" });
  m = await import(pathToFileURL(out).href);
});

// What `pm the village` prints off a terminal (shape from core's InputRequiredResult).
const hitQuestion = {
  resultType: "input_required",
  inputRequests: {
    hit: {
      message: "Select a release",
      choices: [
        { key: "local:/Plex/Movies/The.Village.mkv", label: "The.Village.mkv (local)", row: { kind: "local", title: "The.Village.mkv" } },
        { key: "abc123", label: "The.Village.2004.1080p", row: { kind: "indexer", title: "The.Village.2004.1080p", infoHash: "abc123", indexer: "TPB" } },
      ],
    },
  },
  answers: {},
};
const destQuestion = {
  resultType: "input_required",
  inputRequests: {
    dest: {
      message: "Download to",
      initial: "movie",
      choices: [
        { key: "movie", label: "Movies", hint: "suggested" },
        { key: "tv", label: "TV" },
        { key: "music", label: "Music" },
      ],
    },
  },
  answers: { hit: "abc123" },
};

test("an input_required result is a question; anything else is not", () => {
  const ir = m.inputRequired(hitQuestion);
  assert.equal(ir.questions.length, 1);
  assert.equal(ir.questions[0].key, "hit");
  assert.equal(ir.questions[0].message, "Select a release");
  assert.equal(ir.questions[0].choices[1].row.infoHash, "abc123");
  assert.deepEqual(ir.answers, {});
  assert.equal(m.inputRequired({ hits: [] }), undefined);
  assert.equal(m.inputRequired({ resultType: "input_required", inputRequests: { hit: { message: "x", choices: [] } } }), undefined);
});

test("a run that exits 10 with input_required is a question, not a failure", () => {
  assert.equal(runStatus({ code: 0 }), "done");
  assert.equal(runStatus({ code: 10, json: hitQuestion }), "input-required");
  assert.equal(runStatus({ code: 10, json: { hits: [] } }), "failed");
  assert.equal(runStatus({ code: 1, json: hitQuestion }), "failed");
});

test("the rerun carries every answer so far, replacing the old --answer pairs", () => {
  assert.deepEqual(m.answerArgv(["search", "the village"], { hit: "abc123" }), ["search", "the village", "--answer", "hit=abc123"]);
  assert.deepEqual(
    m.answerArgv(["search", "the village", "--answer", "hit=abc123", "--answer=dest=tv"], { hit: "abc123", dest: "movie" }),
    ["search", "the village", "--answer", "hit=abc123", "--answer", "dest=movie"],
  );
  assert.deepEqual(m.answerArgv(["x", "--", "--answer"], { a: "b" }), ["x", "--answer", "a=b", "--", "--answer"]);
});

test("keys: ↓ lands on the suggested choice, ↵ answers it on top of the earlier answers, esc/↑ go back", () => {
  const dest = m.inputRequired(destQuestion);
  assert.equal(m.askKey({ at: "line" }, "enter", dest), undefined);
  assert.deepEqual(m.askKey({ at: "line" }, "down", dest), { focus: { at: "rows", sel: 0 } });
  assert.deepEqual(m.askKey({ at: "rows", sel: 0 }, "down", dest), { focus: { at: "rows", sel: 1 } });
  assert.deepEqual(m.askKey({ at: "rows", sel: 2 }, "down", dest), { focus: { at: "rows", sel: 2 } });
  assert.deepEqual(m.askKey({ at: "rows", sel: 0 }, "up", dest), { focus: { at: "line" } });
  assert.deepEqual(m.askKey({ at: "rows", sel: 1 }, "escape", dest), { focus: { at: "line" } });
  assert.deepEqual(m.askKey({ at: "rows", sel: 0 }, "enter", dest), { focus: { at: "line" }, answers: { hit: "abc123", dest: "movie" } });

  const tvFirst = m.inputRequired({ ...destQuestion, inputRequests: { dest: { ...destQuestion.inputRequests.dest, initial: "tv" } } });
  assert.deepEqual(m.askKey({ at: "line" }, "down", tvFirst), { focus: { at: "rows", sel: 1 } });

  const hit = m.inputRequired(hitQuestion);
  assert.deepEqual(m.askKey({ at: "rows", sel: 1 }, "enter", hit).answers, { hit: "abc123" });
});
