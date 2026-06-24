import { describe, it, expect } from "vitest";
import { planImport, uniqueId } from "@inspector/core/mcp/import/merge.js";
import type { MCPConfig } from "@inspector/core/mcp/types.js";

const incoming: MCPConfig = {
  mcpServers: {
    alpha: { type: "stdio", command: "a" },
    beta: { type: "stdio", command: "b" },
    gamma: { type: "stdio", command: "g" },
  },
};

describe("planImport", () => {
  it("splits incoming servers into additions and conflicts", () => {
    const plan = planImport(incoming, ["beta"]);
    expect(plan.additions.map((a) => a.id)).toEqual(["alpha", "gamma"]);
    expect(plan.conflicts.map((c) => c.id)).toEqual(["beta"]);
    expect(plan.conflicts[0].config).toEqual({ type: "stdio", command: "b" });
  });

  it("treats everything as an addition when nothing collides", () => {
    const plan = planImport(incoming, []);
    expect(plan.additions).toHaveLength(3);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("preserves source map order", () => {
    const plan = planImport(incoming, []);
    expect(plan.additions.map((a) => a.id)).toEqual(["alpha", "beta", "gamma"]);
  });
});

describe("uniqueId", () => {
  it("returns the base when free", () => {
    expect(uniqueId("github", ["slack"])).toBe("github");
  });

  it("suffixes -2, -3 … when taken", () => {
    expect(uniqueId("github", ["github"])).toBe("github-2");
    expect(uniqueId("github", ["github", "github-2"])).toBe("github-3");
  });

  it("sanitizes the base to the allowed charset", () => {
    expect(uniqueId("My Server!", [])).toBe("My-Server");
  });

  it("falls back to 'server' for an all-invalid base", () => {
    expect(uniqueId("!!!", [])).toBe("server");
    expect(uniqueId("!!!", ["server"])).toBe("server-2");
  });
});
