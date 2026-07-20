import { describe, it, expect } from "vitest";
import { hoistAtSession } from "../src/session/dispatch.js";

describe("hoistAtSession", () => {
  it("lifts a leading @name into sessionFromAt", () => {
    const { argv, sessionFromAt } = hoistAtSession([
      "node",
      "mcp",
      "@alpha",
      "tools/list",
      "--format",
      "json",
    ]);
    expect(sessionFromAt).toBe("alpha");
    expect(argv).toEqual(["node", "mcp", "tools/list", "--format", "json"]);
  });

  it("leaves argv unchanged when there is no @name", () => {
    const input = ["node", "mcp", "tools/list"];
    expect(hoistAtSession(input)).toEqual({ argv: input });
  });
});
