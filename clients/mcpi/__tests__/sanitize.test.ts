/**
 * Terminal-escape sanitization (security). Server-controlled strings must
 * never reach the terminal as raw control bytes — see src/session/sanitize.ts
 * for the threat catalogue (OSC 52 clipboard writes, title spoofing, CSI
 * rewriting, OSC 8 hyperlink breakout).
 */
import { describe, expect, it } from "vitest";
import { sanitizeDeep, sanitizeText } from "../src/session/sanitize.js";

describe("sanitizeText", () => {
  it("neutralizes an OSC 52 clipboard-write sequence", () => {
    const attack = "\u001b]52;c;bWFsaWNpb3Vz\u0007done";
    const out = sanitizeText(attack);
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("\u0007");
    expect(out).toBe("\u241b]52;c;bWFsaWNpb3Vz\u2407done");
  });

  it("neutralizes OSC title spoofing and CSI cursor rewriting", () => {
    expect(sanitizeText("\u001b]0;fake title\u0007")).toBe(
      "\u241b]0;fake title\u2407",
    );
    expect(sanitizeText("\u001b[2J\u001b[H")).toBe("\u241b[2J\u241b[H");
  });

  it("neutralizes a BEL/ESC breakout inside a URI (OSC 8 wrapper safety)", () => {
    const uri = "https://ok.test/\u0007\u001b]8;;https://evil.test\u0007";
    const out = sanitizeText(uri);
    expect(out.includes("\u0007")).toBe(false);
    expect(out.includes("\u001b")).toBe(false);
  });

  it("replaces C1 controls (8-bit CSI/OSC) with visible text", () => {
    expect(sanitizeText("\u009b31mred")).toBe("\\u{9b}31mred");
    expect(sanitizeText("\u009d0;t\u009c")).toBe("\\u{9d}0;t\\u{9c}");
  });

  it("replaces DEL and CR but preserves newline and tab", () => {
    expect(sanitizeText("a\u007fb\rc")).toBe("a\u2421b\u240dc");
    expect(sanitizeText("line1\nline2\tend")).toBe("line1\nline2\tend");
  });

  it("leaves ordinary text (including non-ASCII) untouched", () => {
    const s = "hello — ünïcode ✅ 日本語";
    expect(sanitizeText(s)).toBe(s);
  });
});

describe("sanitizeDeep", () => {
  it("sanitizes nested string values, array items, and object keys", () => {
    const input = {
      name: "tool\u001b[1m",
      items: ["ok", "bad\u0007"],
      nested: { "\u001bkey": { deep: "\u009btext" } },
    };
    expect(sanitizeDeep(input)).toEqual({
      name: "tool\u241b[1m",
      items: ["ok", "bad\u2407"],
      nested: { "\u241bkey": { deep: "\\u{9b}text" } },
    });
  });

  it("passes non-string primitives and null through unchanged", () => {
    expect(sanitizeDeep(42)).toBe(42);
    expect(sanitizeDeep(true)).toBe(true);
    expect(sanitizeDeep(null)).toBe(null);
    expect(sanitizeDeep(undefined)).toBe(undefined);
  });

  it("does not mutate the input object", () => {
    const input = { text: "esc\u001b" };
    const out = sanitizeDeep(input);
    expect(input.text).toBe("esc\u001b");
    expect(out.text).toBe("esc\u241b");
  });
});
