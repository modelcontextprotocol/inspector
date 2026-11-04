/**
 * Tests for the linear-time `pattern` matcher (core/json/linearRegExp.ts).
 *
 * Two properties carry the fix: the matcher answers exactly what the native
 * engine answers (checked differentially over a corpus that exercises every
 * parser branch), and its work is bounded by input length × program size
 * whatever the pattern's shape (checked on the catastrophic shapes, with the
 * bound asserted rather than timed, so there is nothing to flake).
 */
import { describe, it, expect } from "vitest";
import {
  compileLinearRegExp,
  MAX_COMPILE_STEPS,
  MAX_PROGRAM_SIZE,
  type LinearRegExp,
} from "@inspector/core/json/linearRegExp";

const NO_LIMIT = Number.MAX_SAFE_INTEGER;

function compiled(pattern: string, unicode = true): LinearRegExp {
  const result = compileLinearRegExp(pattern, unicode);
  if (!result.ok) throw new Error(`unexpectedly unsupported: ${result.reason}`);
  return result.regExp;
}

function unsupportedReason(pattern: string, unicode = true): string {
  const result = compileLinearRegExp(pattern, unicode);
  if (result.ok) throw new Error(`unexpectedly supported: ${pattern}`);
  return result.reason;
}

/** Patterns valid under both flag settings, each with probe inputs. */
const SHARED_CORPUS: [string, string[]][] = [
  ["", ["", "x"]],
  ["abc", ["abc", "xabcx", "ab", ""]],
  ["^abc$", ["abc", "abcd", "zabc"]],
  ["^a+$", ["a", "aaaa", "", "aab"]],
  ["^a*b?c{2}$", ["cc", "acc", "aabcc", "abc", "bbcc"]],
  ["^a{2,}$", ["a", "aa", "aaaaa"]],
  ["^a{1,3}$", ["", "a", "aaa", "aaaa"]],
  ["^a{0}b$", ["b", "ab"]],
  ["^a+?b*?$", ["a", "ab", "b"]],
  ["^(a|bc|)d$", ["ad", "bcd", "d", "bd"]],
  ["^(?:ab)+$", ["ab", "abab", "aba"]],
  ["^(?<word>\\w+)-(\\d+)$", ["abc-12", "abc-", "-12"]],
  ["^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$", ["a.b@c.io", "a@b", "@b.io"]],
  ["^[^\\s]+$", ["abc", "a c", ""]],
  ["[\\]]", ["]", "a"]],
  ["^\\d\\D\\w\\W\\s\\S$", ["1a_ \tx", "1a_  x", "aa_ \tx"]],
  ["\\bfoo\\b", ["foo", "a foo b", "afoo", "foob"]],
  ["\\Bo\\B", ["foo bar", "o", "too"]],
  ["^.$", ["a", "\n", "ab"]],
  ["^\\x41\\u0042$", ["AB", "AC"]],
  ["^\\cJ$", ["\n", "J"]],
  ["^a\\0b$", ["a\0b", "a0b"]],
  ["^\\.\\*\\/$", [".*/", "a*/"]],
  ["^(a*)*$", ["", "aaaa", "aab"]],
  ["^(|a)+$", ["", "a", "aa", "b"]],
  ["^(a|a)*b$", ["aaab", "aaa"]],
  ["^((ab)+c)+$", ["abcababc", "abca"]],
  ["(\\d{1,3}\\.){3}\\d{1,3}", ["10.0.0.1", "10.0.1"]],
  ["^é+$", ["éé", "e"]],
];

/** Patterns whose meaning depends on the `u` flag. */
const UNICODE_CORPUS: [string, string[]][] = [
  ["^\u{1F600}+$", ["\u{1F600}\u{1F600}", "\u{1F600}x", "\uD83D"]],
  ["^.$", ["\u{1F600}", "\uD83D"]],
  ["^\\u{1F600}$", ["\u{1F600}", "x"]],
  ["^\\uD83D\\uDE00$", ["\u{1F600}", "\uD83D"]],
  ["^\\uD83D\\u0041$", ["\uD83DA", "A"]],
  ["^\\p{L}+\\P{L}$", ["abc1", "abc", "éé!"]],
  ["^[\\p{Lu}]$", ["A", "a"]],
];

/** Patterns that are only valid (or only mean this) without the `u` flag. */
const LEGACY_CORPUS: [string, string[]][] = [
  ["^.$", ["\u{1F600}", "\uD83D"]],
  ["^a{x$", ["a{x", "ax"]],
  ["^]}$", ["]}", "]"]],
  ["^\\p$", ["p", "\\p"]],
  ["^\\u004$", ["u004", "\\u004"]],
  ["^\\x4G$", ["x4G", "\\x4G"]],
  ["^\\uD83D\\uDE0$", ["\uD83D\\uDE0", "uDE0"]],
  ["^\\u{2}$", ["uu", "u"]],
  ["^\u{1F600}$", ["\u{1F600}", "\uD83D"]],
  ["^\\\u{1F600}$", ["\u{1F600}", "x"]],
];

describe("compileLinearRegExp — agrees with the native engine", () => {
  const cases: [string, boolean, string[]][] = [
    ...SHARED_CORPUS.map(([p, s]): [string, boolean, string[]] => [p, true, s]),
    ...SHARED_CORPUS.map(([p, s]): [string, boolean, string[]] => [
      p,
      false,
      s,
    ]),
    ...UNICODE_CORPUS.map(([p, s]): [string, boolean, string[]] => [
      p,
      true,
      s,
    ]),
    ...LEGACY_CORPUS.map(([p, s]): [string, boolean, string[]] => [
      p,
      false,
      s,
    ]),
  ];
  it.each(cases)("/%s/ (unicode: %s)", (pattern, unicode, inputs) => {
    const native = new RegExp(pattern, unicode ? "u" : "");
    const linear = compiled(pattern, unicode);
    for (const input of inputs) {
      expect(
        { input, matched: linear.search(input, NO_LIMIT) },
        `/${pattern}/ on ${JSON.stringify(input)}`,
      ).toEqual({ input, matched: native.test(input) });
    }
  });
});

describe("compileLinearRegExp — unsupported constructs", () => {
  it.each([
    ["(?=a)a", "lookaround or group modifier"],
    ["(?!a)b", "lookaround or group modifier"],
    ["(?<=a)b", "lookaround or group modifier"],
    ["(?<!a)b", "lookaround or group modifier"],
    ["(a)\\1", "backreference"],
    ["(?<n>a)\\k<n>", "backreference"],
  ])("declines /%s/", (pattern, reason) => {
    expect(unsupportedReason(pattern)).toBe(reason);
  });

  it("declines legacy octal and incomplete control escapes", () => {
    expect(unsupportedReason("\\01", false)).toBe("octal escape");
    expect(unsupportedReason("\\c1", false)).toBe("incomplete control escape");
    expect(unsupportedReason("a\\c", false)).toBe("incomplete control escape");
    expect(unsupportedReason("\\k", false)).toBe("backreference");
  });

  it("declines groups nested past the depth limit", () => {
    const deep = `${"(".repeat(70)}a${")".repeat(70)}`;
    expect(unsupportedReason(deep)).toBe("groups nested too deeply");
  });

  it("declines a pattern that expands past the program size limit", () => {
    expect(unsupportedReason(`a{${MAX_PROGRAM_SIZE + 1}}`)).toBe(
      "pattern too complex",
    );
    expect(unsupportedReason("(a{1,200}){1,200}")).toBe("pattern too complex");
  });

  it("compiles a huge counted repeat of an empty body without expanding it", () => {
    // Without the empty-body cut-off each of these loops `min` times while
    // emitting nothing, so the program-size cap never fires and compilation
    // never returns; with it, each compiles to a program of the empty match.
    for (const pattern of [
      "(){1000000000000}",
      "(?:){1000000000000}",
      "(a{0}){1000000000000}",
      "((){1000}){1000000000}",
      "(){1000000000000,}",
      "(a{0}){5,1000000000000}",
      "^(a{0}){1000000000000}$",
    ]) {
      const regExp = compiled(pattern);
      expect(regExp.size, pattern).toBeLessThanOrEqual(4);
      expect(regExp.search("", NO_LIMIT), pattern).toBe(true);
    }
    expect(compiled("^(a{0}){1000000000000}$").search("a", NO_LIMIT)).toBe(
      false,
    );
  });

  it("declines a huge bounded repeat of an empty body at the program size limit", () => {
    // Nothing emitted by a mandatory copy cuts these short, so the optional
    // copies each emit a split and the program-size cap stops the expansion.
    expect(unsupportedReason("(){0,1000000000000}")).toBe(
      "pattern too complex",
    );
    expect(unsupportedReason("(a{0}){0,1000000000000}")).toBe(
      "pattern too complex",
    );
  });

  it("declines a repeat whose body costs compile work without emitting", () => {
    // Each copy visits 21 nodes but emits one instruction, so the program
    // stays under its cap while the work does not: the step cap stops it.
    const body = `(?:${"(){0}".repeat(20)}x)`;
    const copies = Math.ceil(MAX_COMPILE_STEPS / 21) + 1;
    expect(copies).toBeLessThan(MAX_PROGRAM_SIZE);
    expect(unsupportedReason(`${body}{${copies}}`)).toBe("pattern too complex");
  });

  it("lets an invalid pattern throw, as the native engine would", () => {
    expect(() => compileLinearRegExp("(a", true)).toThrow(SyntaxError);
    expect(() => compileLinearRegExp("a{2,1}", true)).toThrow(SyntaxError);
  });
});

describe("LinearRegExp — bounded work", () => {
  it("answers catastrophic-backtracking shapes without backtracking", () => {
    // Each of these takes exponential (or high-polynomial) time on the
    // native engine at these lengths; here each is one pass.
    const nearMiss = `${"a".repeat(5_000)}!`;
    for (const pattern of [
      "^(a+)+$",
      "^(a|a)*$",
      "^(a|aa)+$",
      "^(a*)*$",
      "^(\\w+\\s?)+$",
      "a*a*a*a*a*b",
    ]) {
      const regExp = compiled(pattern);
      expect(regExp.search(nearMiss, NO_LIMIT), pattern).toBe(false);
      expect(regExp.search("a".repeat(5_000), NO_LIMIT), pattern).toBe(
        pattern !== "a*a*a*a*a*b",
      );
    }
  });

  it("reports its cost as input length x program size", () => {
    const regExp = compiled("^(a+)+$");
    expect(regExp.size).toBeGreaterThan(0);
    expect(regExp.cost("aaaa")).toBe(5 * regExp.size);
  });

  it("declines to run, answering undefined, when the cost exceeds the budget", () => {
    const regExp = compiled("^(a+)+$");
    const input = "a".repeat(100);
    expect(regExp.search(input, regExp.cost(input) - 1)).toBeUndefined();
    expect(regExp.search(input, regExp.cost(input))).toBe(true);
  });

  it("stops early once a start-anchored pattern has no live thread", () => {
    expect(compiled("^ab").search(`x${"a".repeat(10_000)}`, NO_LIMIT)).toBe(
      false,
    );
  });
});
