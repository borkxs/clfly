import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
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

const errorsUrl = new URL("../src/errors.ts", import.meta.url).href;
const dir = mkdtempSync(join(tmpdir(), "clfly-run-errors-"));
writeFileSync(
  join(dir, "loud.ts"),
  `import { ClflyError } from ${JSON.stringify(errorsUrl)};
export default async function () { throw new ClflyError("went wrong", 3); }
`,
);
writeFileSync(
  join(dir, "quiet.ts"),
  `import { ReportedExit } from ${JSON.stringify(errorsUrl)};
export default async function () { throw new ReportedExit(4, "disk full"); }
`,
);
writeFileSync(
  join(dir, "cancel.ts"),
  `import { ReportedExit } from ${JSON.stringify(errorsUrl)};
export default async function () { throw new ReportedExit(0); }
`,
);
writeFileSync(
  join(dir, "blank.ts"),
  `import { ClflyError } from ${JSON.stringify(errorsUrl)};
export default async function () { throw new ClflyError("", 5); }
`,
);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function run(argv: string[]) {
  const out = collect();
  const err = collect();
  const cli = createCli({ name: "t", commandsDir: dir, stdout: out.stream, stderr: err.stream });
  const result = await cli.runUnlogged(argv, out.stream);
  return { exitCode: result.exitCode, stderr: err.text() };
}

describe("ClflyError on the CLI run path", () => {
  it("prints the message and returns its exit code", async () => {
    expect(await run(["loud"])).toEqual({ exitCode: 3, stderr: "went wrong\n" });
  });

  it("ReportedExit returns its code without printing (the terminal already showed why)", async () => {
    expect(await run(["quiet"])).toEqual({ exitCode: 4, stderr: "" });
    expect(await run(["cancel"])).toEqual({ exitCode: 0, stderr: "" });
  });

  it("ReportedExit under --json still writes the error object for a failure, not a cancel", async () => {
    const failed = await run(["quiet", "--json"]);
    expect(failed.exitCode).toBe(4);
    expect(JSON.parse(failed.stderr)).toEqual({ error: { message: "disk full" } });
    expect(await run(["cancel", "--json"])).toEqual({ exitCode: 0, stderr: "" });
  });

  it("a plain ClflyError with an empty message is not swallowed", async () => {
    expect(await run(["blank"])).toEqual({ exitCode: 5, stderr: "Failed (exit 5).\n" });
  });
});
