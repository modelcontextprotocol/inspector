import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { runMcp } from "./helpers/mcp-runner.js";

describe("mcpdo agent-help", () => {
  it("prints the SKILL.md body with the frontmatter stripped", async () => {
    const result = await runMcp(["agent-help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("mcpdo connect");
    expect(result.stdout).not.toContain("name: mcpdo");
    expect(result.stdout.startsWith("---")).toBe(false);
  });

  it("--skill explicitly selects the default guide output", async () => {
    const [bare, explicit] = [
      await runMcp(["agent-help"]),
      await runMcp(["agent-help", "--skill"]),
    ];
    expect(explicit.exitCode).toBe(0);
    expect(explicit.stdout).toBe(bare.stdout);
  });

  it("--skill-path prints the resolved SKILL.md file path", async () => {
    const result = await runMcp(["agent-help", "--skill-path"]);
    expect(result.exitCode).toBe(0);
    const printedPath = result.stdout.trim();
    expect(printedPath.endsWith("skills/mcpdo/SKILL.md")).toBe(true);
    expect(existsSync(printedPath)).toBe(true);
  });

  it("--instructions prints the always-on CLAUDE.md/AGENTS.md snippet", async () => {
    const result = await runMcp(["agent-help", "--instructions"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("part of your available toolset");
    expect(result.stdout).toContain("mcpdo agent-help");
  });

  it("rejects --instructions combined with --skill-path", async () => {
    const result = await runMcp([
      "agent-help",
      "--instructions",
      "--skill-path",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("mutually exclusive");
  });
});
