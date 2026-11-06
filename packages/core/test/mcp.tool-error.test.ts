import { describe, expect, it } from "vitest";
import { ClflyError, ReportedExit } from "../src/errors.js";
import { toolResultForError } from "../src/mcp/project.js";

const text = (r: ReturnType<typeof toolResultForError>) =>
  r.result.content[0]?.type === "text" ? r.result.content[0].text : undefined;

describe("toolResultForError (MCP path for a thrown command error)", () => {
  it("a ClflyError is a tool error with its message and code", () => {
    const r = toolResultForError(new ClflyError("went wrong", 3));
    expect([r.result.isError, text(r), r.exitCode]).toEqual([true, "went wrong", 3]);
  });

  it("a ReportedExit failure is a tool error with its message, never blank", () => {
    const r = toolResultForError(new ReportedExit(1, "aria2c not found"));
    expect([r.result.isError, text(r), r.exitCode]).toEqual([true, "aria2c not found", 1]);
    expect(text(toolResultForError(new ReportedExit(2)))).toBe("Failed (exit 2).");
  });

  it("a ReportedExit cancel (exit 0) is a plain result, logged as exit 0", () => {
    const r = toolResultForError(new ReportedExit(0));
    expect([r.result.isError, text(r), r.exitCode]).toEqual([undefined, "Cancelled.", 0]);
  });

  it("an empty-message error still gets text", () => {
    expect(text(toolResultForError(new ClflyError("", 4)))).toBe("Failed (exit 4).");
    expect(text(toolResultForError(new Error("")))).toBe("Failed (exit 1).");
  });
});
