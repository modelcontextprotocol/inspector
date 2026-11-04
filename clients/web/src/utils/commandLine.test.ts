import { describe, it, expect } from "vitest";
import { formatCommandLine, quoteShellArg } from "./commandLine";

describe("quoteShellArg", () => {
  it("leaves shell-safe tokens bare", () => {
    expect(quoteShellArg("@scope/pkg@1.0.0")).toBe("@scope/pkg@1.0.0");
    expect(quoteShellArg("-y")).toBe("-y");
    expect(quoteShellArg("/data:/data")).toBe("/data:/data");
  });

  it("single-quotes tokens with whitespace or metacharacters", () => {
    expect(quoteShellArg("a b")).toBe("'a b'");
    expect(quoteShellArg("$(id)")).toBe("'$(id)'");
    expect(quoteShellArg("")).toBe("''");
  });

  it("escapes an embedded single quote", () => {
    expect(quoteShellArg("it's")).toBe(`'it'\\''s'`);
  });
});

describe("formatCommandLine", () => {
  it("joins the command and its quoted args", () => {
    expect(formatCommandLine("npx", ["-c", "rm -rf ~", "-y", "pkg"])).toBe(
      "npx -c 'rm -rf ~' -y pkg",
    );
  });

  it("renders a bare command when there are no args", () => {
    expect(formatCommandLine("uvx")).toBe("uvx");
  });
});
