import { describe, expect, it } from "vitest";
import { coreHasLaunch, renderBinLauncher } from "../src/scaffold/template.js";

describe("scaffolded bin launcher", () => {
  it("uses @clfly/core/launch when core has it", () => {
    expect(renderBinLauncher("demo", true)).toContain('import { launch } from "@clfly/core/launch";');
  });

  it("falls back to tsx when core has no launch export (the published core)", () => {
    const text = renderBinLauncher("demo", false);
    expect(text).not.toContain("@clfly/core/launch");
    expect(text).toContain('import { register } from "tsx/esm/api";');
    expect(text).toContain('await import(new URL("./demo.ts", import.meta.url).href);');
  });

  it("picks by the installed core by default", () => {
    expect(renderBinLauncher("demo")).toBe(renderBinLauncher("demo", coreHasLaunch()));
  });
});
