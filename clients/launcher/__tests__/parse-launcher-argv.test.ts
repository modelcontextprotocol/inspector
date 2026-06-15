import { describe, expect, it } from "vitest";
import { parseLauncherArgv } from "../src/parse-launcher-argv.js";

const EXEC = ["node", "/path/to/launcher/build/index.js"];

describe("parseLauncherArgv", () => {
  it("defaults to web when no mode flag is in the prefix", () => {
    expect(parseLauncherArgv([...EXEC, "--method", "tools/list"])).toEqual({
      mode: "web",
      forwardedArgv: [...EXEC, "--method", "tools/list"],
      hasPrefixModeFlag: false,
    });
  });

  it("selects mode from a leading mode flag and strips only the prefix", () => {
    expect(
      parseLauncherArgv([...EXEC, "--cli", "node", "./server.js", "--cli"]),
    ).toEqual({
      mode: "cli",
      forwardedArgv: [...EXEC, "node", "./server.js", "--cli"],
      hasPrefixModeFlag: true,
    });
  });

  it("does not treat a trailing mode-like token as launcher mode", () => {
    expect(parseLauncherArgv([...EXEC, "node", "./server.js", "--cli"])).toEqual(
      {
        mode: "web",
        forwardedArgv: [...EXEC, "node", "./server.js", "--cli"],
        hasPrefixModeFlag: false,
      },
    );
  });

  it("rejects multiple mode flags in the launcher prefix", () => {
    expect(() => parseLauncherArgv([...EXEC, "--cli", "--tui"])).toThrow(
      /at most one of --web, --cli, or --tui/,
    );
  });

  it("forwards a later mode-like token after non-mode app args", () => {
    expect(
      parseLauncherArgv([...EXEC, "--tui", "--config", "x", "--cli"]),
    ).toEqual({
      mode: "tui",
      forwardedArgv: [...EXEC, "--config", "x", "--cli"],
      hasPrefixModeFlag: true,
    });
  });
});
