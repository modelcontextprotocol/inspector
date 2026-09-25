import { describe, it, expect } from "vitest";
import {
  parseToolCallPositionals,
  resolveToolCallArgs,
} from "../src/connection/parse-tool-args.js";

describe("parseToolCallPositionals", () => {
  it("parses key:=value with JSON typing", () => {
    expect(
      parseToolCallPositionals([
        "message:=Foo",
        "count:=10",
        "enabled:=true",
        'cfg:={"a":1}',
        'id:="012"',
      ]),
    ).toEqual({
      message: "Foo",
      count: 10,
      enabled: true,
      cfg: { a: 1 },
      id: "012",
    });
  });

  it('keeps a literal "__proto__" key as an own property, matching the inline-JSON path', () => {
    // On a plain {} accumulator this key would hit the prototype setter and
    // vanish while remapping the accumulator's prototype.
    const out = parseToolCallPositionals(['__proto__:={"polluted":true}']);
    expect(Object.getOwnPropertyNames(out)).toContain("__proto__");
    expect(Object.getOwnPropertyDescriptor(out, "__proto__")?.value).toEqual({
      polluted: true,
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("parses a single inline JSON object", () => {
    expect(parseToolCallPositionals(['{"message":"Foo","count":2}'])).toEqual({
      message: "Foo",
      count: 2,
    });
  });

  it("rejects bare values, arrays, and mixed JSON+pairs", () => {
    expect(() => parseToolCallPositionals(["foo"])).toThrow(/key:=value/);
    expect(() => parseToolCallPositionals(["[1]"])).toThrow(/JSON object/);
    expect(() => parseToolCallPositionals(["{not-json"])).toThrow(
      /Invalid JSON/,
    );
    expect(() => parseToolCallPositionals(['{"a":1}', "b:=2"])).toThrow(
      /only one argument/,
    );
    expect(() => parseToolCallPositionals([":=x"])).toThrow(/missing key/);
    expect(parseToolCallPositionals([])).toEqual({});
  });
});

describe("resolveToolCallArgs", () => {
  it("uses positionals as the default style", () => {
    expect(
      resolveToolCallArgs({
        toolNamePos: "echo",
        toolArgsPos: ["message:=hi"],
      }),
    ).toEqual({ toolName: "echo", toolArg: { message: "hi" } });
  });

  it("treats the name slot as an arg when --tool-name is set", () => {
    expect(
      resolveToolCallArgs({
        toolNameFlag: "echo",
        toolNamePos: "message:=hi",
      }),
    ).toEqual({ toolName: "echo", toolArg: { message: "hi" } });
  });

  it("keeps --tool-arg and --tool-args-json as alternatives", () => {
    expect(
      resolveToolCallArgs({
        toolNamePos: "echo",
        toolArgFlag: { message: "via-flag" },
      }),
    ).toEqual({ toolName: "echo", toolArg: { message: "via-flag" } });

    expect(
      resolveToolCallArgs({
        toolNamePos: "echo",
        toolArgsJson: '{"message":"json"}',
      }),
    ).toEqual({ toolName: "echo", toolArg: { message: "json" } });
  });

  it("rejects mixing argument styles", () => {
    expect(() =>
      resolveToolCallArgs({
        toolNamePos: "echo",
        toolArgsPos: ["message:=a"],
        toolArgFlag: { message: "b" },
      }),
    ).toThrow(/one style/);
    expect(() =>
      resolveToolCallArgs({
        toolNamePos: "echo",
        toolArgsPos: ["message:=a"],
        toolArgsJson: '{"message":"b"}',
      }),
    ).toThrow(/one style/);
  });

  it("rejects invalid --tool-args-json", () => {
    expect(() =>
      resolveToolCallArgs({
        toolNamePos: "echo",
        toolArgsJson: "{bad",
      }),
    ).toThrow(/not valid JSON/);
    expect(() =>
      resolveToolCallArgs({
        toolNamePos: "echo",
        toolArgsJson: "[]",
      }),
    ).toThrow(/must be a JSON object/);
    expect(() =>
      resolveToolCallArgs({
        toolNamePos: "echo",
        toolArgsJson: "null",
      }),
    ).toThrow(/must be a JSON object/);
  });
});
