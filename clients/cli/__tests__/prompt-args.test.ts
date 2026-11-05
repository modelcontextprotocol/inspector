/**
 * Unit tests for `parsePromptArgPair` (core/cli/utils/prompt-args.ts), the
 * string-only `--prompt-args` parser the one-shot CLI and mcpdo share (#2859).
 * Lives here because `clients/cli` gates `core/cli/` coverage.
 */
import { describe, it, expect } from "vitest";
import { parsePromptArgPair } from "@inspector/core/cli/utils/prompt-args.js";

describe("parsePromptArgPair", () => {
  it.each([
    ["1.50"],
    ["0.10"],
    ["1e3"],
    ["9007199254740993"],
    ["true"],
    ["null"],
    ['{"a":1}'],
    ['"quoted"'],
    [""],
  ])("keeps %j verbatim as a string", (value) => {
    expect(parsePromptArgPair(`k=${value}`)).toEqual({ k: value });
  });

  it("splits on the first '=' only", () => {
    expect(parsePromptArgPair("expr=a=b=c")).toEqual({ expr: "a=b=c" });
  });

  it("accumulates into the previous record, later keys winning", () => {
    const first = parsePromptArgPair("a=1");
    const second = parsePromptArgPair("b=2", first);
    expect(parsePromptArgPair("a=3", second)).toEqual({ a: "3", b: "2" });
    expect(first).toEqual({ a: "1" });
  });

  it.each([["novalue"], ["=value"], [""]])(
    "rejects %j (missing '=' or empty key)",
    (pair) => {
      expect(() => parsePromptArgPair(pair)).toThrow(
        /Invalid parameter format.*Use key=value format/,
      );
    },
  );
});
