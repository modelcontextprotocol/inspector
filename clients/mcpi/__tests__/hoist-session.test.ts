import { describe, it, expect } from "vitest";
import { hoistAtSession } from "../src/session/dispatch.js";

describe("hoistAtSession", () => {
  it("lifts a leading @name into sessionFromAt", () => {
    const { argv, sessionFromAt } = hoistAtSession([
      "node",
      "mcpi",
      "@alpha",
      "tools/list",
      "--format",
      "json",
    ]);
    expect(sessionFromAt).toBe("alpha");
    expect(argv).toEqual(["node", "mcpi", "tools/list", "--format", "json"]);
  });

  it("leaves argv unchanged when there is no @name", () => {
    const input = ["node", "mcpi", "tools/list"];
    expect(hoistAtSession(input)).toEqual({ argv: input });
  });
});
