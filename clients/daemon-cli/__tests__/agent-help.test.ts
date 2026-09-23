import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { runMcp } from "./helpers/mcp-runner.js";

describe("mcpdo agent-help", () => {
  it("prints skills/mcpdo/SKILL.md content, including its frontmatter", async () => {
    const result = await runMcp(["agent-help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("name: mcpdo");
    expect(result.stdout).toContain("mcpdo connect");
  });

  it("--path prints the resolved SKILL.md file path", async () => {
    const result = await runMcp(["agent-help", "--path"]);
    expect(result.exitCode).toBe(0);
    const printedPath = result.stdout.trim();
    expect(printedPath.endsWith("skills/mcpdo/SKILL.md")).toBe(true);
    expect(existsSync(printedPath)).toBe(true);
  });
});
