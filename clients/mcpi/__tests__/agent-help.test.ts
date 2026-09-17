import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { runMcp } from "./helpers/mcp-runner.js";

describe("mcpi agent-help", () => {
  it("prints skills/mcpi/SKILL.md content, including its frontmatter", async () => {
    const result = await runMcp(["agent-help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("name: mcpi");
    expect(result.stdout).toContain("mcpi connect");
  });

  it("--path prints the resolved SKILL.md file path", async () => {
    const result = await runMcp(["agent-help", "--path"]);
    expect(result.exitCode).toBe(0);
    const printedPath = result.stdout.trim();
    expect(printedPath.endsWith("skills/mcpi/SKILL.md")).toBe(true);
    expect(existsSync(printedPath)).toBe(true);
  });
});
