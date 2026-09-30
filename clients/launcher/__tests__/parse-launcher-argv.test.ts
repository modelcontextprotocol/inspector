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
    expect(
      parseLauncherArgv([...EXEC, "node", "./server.js", "--cli"]),
    ).toEqual({
      mode: "web",
      forwardedArgv: [...EXEC, "node", "./server.js", "--cli"],
      hasPrefixModeFlag: false,
    });
  });

  it("rejects multiple mode flags in the launcher prefix", () => {
    expect(() => parseLauncherArgv([...EXEC, "--cli", "--tui"])).toThrow(
      /at most one of --web, --cli, or --tui/,
    );
  });

  // #2416: the launcher hands `forwardedArgv` to the selected client verbatim,
  // so a Windows-style path must survive with every backslash intact — a UNC
  // prefix, `\n`/`\t` lookalikes and a trailing separator included. String.raw
  // keeps the fixtures exactly what a Windows shell puts in argv.
  const WINDOWS_ARGS = [
    String.raw`C:\Program Files\nodejs\node.exe`,
    String.raw`C:\Users\dev\mcp\build\index.js`,
    String.raw`\\fileserver\share\mcp\config.json`,
    String.raw`--root=C:\temp\new\table` + "\\",
  ];

  it.each([
    ["with a mode flag", ["--cli"], "cli", true],
    ["without a mode flag", [], "web", false],
  ] as const)(
    "forwards Windows-style backslash paths unchanged %s",
    (_label, prefix, mode, hasPrefixModeFlag) => {
      expect(parseLauncherArgv([...EXEC, ...prefix, ...WINDOWS_ARGS])).toEqual({
        mode,
        forwardedArgv: [...EXEC, ...WINDOWS_ARGS],
        hasPrefixModeFlag,
      });
    },
  );

  it("forwards a Windows-style executable path in argv[0..1] unchanged", () => {
    const winExec = [
      String.raw`C:\Program Files\nodejs\node.exe`,
      String.raw`C:\Users\dev\AppData\Roaming\npm\node_modules\@modelcontextprotocol\inspector\clients\launcher\build\index.js`,
    ];
    expect(parseLauncherArgv([...winExec, "--tui", "--config", "x"])).toEqual({
      mode: "tui",
      forwardedArgv: [...winExec, "--config", "x"],
      hasPrefixModeFlag: true,
    });
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
