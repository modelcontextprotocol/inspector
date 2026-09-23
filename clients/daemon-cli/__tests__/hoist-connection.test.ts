import { describe, it, expect } from "vitest";
import { hoistAtConnection } from "../src/connection/dispatch.js";
import { expandConnAlias } from "../src/connection/mcp.js";

describe("hoistAtConnection", () => {
  it("lifts a leading @name into connectionFromAt", () => {
    const { argv, connectionFromAt } = hoistAtConnection([
      "node",
      "mcpdo",
      "@alpha",
      "tools/list",
      "--format",
      "json",
    ]);
    expect(connectionFromAt).toBe("alpha");
    expect(argv).toEqual(["node", "mcpdo", "tools/list", "--format", "json"]);
  });

  it("leaves argv unchanged when there is no @name", () => {
    const input = ["node", "mcpdo", "tools/list"];
    expect(hoistAtConnection(input)).toEqual({ argv: input });
  });
});

describe("expandConnAlias", () => {
  it("expands --conn and --conn=<name> to --connection forms", () => {
    expect(
      expandConnAlias(["node", "mcpdo", "--conn", "alpha", "tools/list"]),
    ).toEqual(["node", "mcpdo", "--connection", "alpha", "tools/list"]);
    expect(expandConnAlias(["node", "mcpdo", "--conn=alpha"])).toEqual([
      "node",
      "mcpdo",
      "--connection=alpha",
    ]);
  });

  it("leaves --connection, --config, and other args unchanged", () => {
    const input = [
      "node",
      "mcpdo",
      "--connection",
      "alpha",
      "--config",
      "x.json",
      "--connect-timeout",
      "5",
    ];
    expect(expandConnAlias(input)).toEqual(input);
  });
});
