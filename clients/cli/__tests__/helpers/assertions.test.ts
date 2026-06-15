import { describe, it, expect } from "vitest";
import { expectCliSuccess, expectCliFailure } from "./assertions.js";
import type { CliResult } from "./cli-runner.js";

function assertionMessage(fn: () => void): string {
  try {
    fn();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("CLI assertion helpers", () => {
  it("expectCliSuccess includes stdout and stderr on failure", () => {
    const result: CliResult = {
      exitCode: 1,
      stdout: "tool output",
      stderr: "connect error",
      output: "tool outputconnect error",
    };

    const message = assertionMessage(() => expectCliSuccess(result));
    expect(message).toContain("CLI exited with code 1");
    expect(message).toContain("stdout: tool output");
    expect(message).toContain("stderr: connect error");
  });

  it("expectCliFailure includes stdout and stderr on unexpected success", () => {
    const result: CliResult = {
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      output: "ok",
    };

    const message = assertionMessage(() => expectCliFailure(result));
    expect(message).toContain("CLI unexpectedly exited with code 0");
    expect(message).toContain("stdout: ok");
    expect(message).toContain("stderr: (empty)");
  });
});
