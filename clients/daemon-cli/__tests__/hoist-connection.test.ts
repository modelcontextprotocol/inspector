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

  it("lifts @name appearing after global options (F4)", () => {
    const { argv, connectionFromAt } = hoistAtConnection([
      "node",
      "mcpdo",
      "--format",
      "json",
      "@srv",
      "tools/list",
    ]);
    expect(connectionFromAt).toBe("srv");
    expect(argv).toEqual(["node", "mcpdo", "--format", "json", "tools/list"]);
  });

  it("lifts @name after inline-value and boolean globals", () => {
    const { argv, connectionFromAt } = hoistAtConnection([
      "node",
      "mcpdo",
      "--format=json",
      "--plain",
      "@srv",
      "logging/tail",
    ]);
    expect(connectionFromAt).toBe("srv");
    expect(argv).toEqual([
      "node",
      "mcpdo",
      "--format=json",
      "--plain",
      "logging/tail",
    ]);
  });

  it("does not claim an option value that looks like @name", () => {
    const input = ["node", "mcpdo", "--connection", "@alpha", "tools/list"];
    // `--connection`'s value is consumed as a value, not hoisted (it is
    // stripped of its @ by the consumption site instead).
    expect(hoistAtConnection(input)).toEqual({ argv: input });
  });

  it("does not claim an @-positional after the subcommand", () => {
    const input = ["node", "mcpdo", "tools/call", "@notaconn"];
    expect(hoistAtConnection(input)).toEqual({ argv: input });
  });

  it("stops at -- (child-process args)", () => {
    const input = ["node", "mcpdo", "--", "@child-arg"];
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

  it("passes tokens after -- through verbatim (child-process args)", () => {
    expect(
      expandConnAlias([
        "node",
        "mcpdo",
        "--conn",
        "alpha",
        "connect",
        "srv",
        "--",
        "--conn=value",
        "--conn",
      ]),
    ).toEqual([
      "node",
      "mcpdo",
      "--connection",
      "alpha",
      "connect",
      "srv",
      "--",
      "--conn=value",
      "--conn",
    ]);
    // Only the first separator ends expansion; later ones are child args too.
    const onlyAfter = ["node", "mcpdo", "--", "--conn", "--", "--conn=x"];
    expect(expandConnAlias(onlyAfter)).toEqual(onlyAfter);
  });
});
