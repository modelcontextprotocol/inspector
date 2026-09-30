import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "./helpers/renderTui";
import { BodyLines } from "../src/components/BodyLines.js";
import {
  MAX_BODY_LINE_CHARS,
  MAX_BODY_LINES,
  clipLine,
  formatBody,
  layoutBody,
} from "../src/utils/bodyLines.js";

describe("bodyLines", () => {
  it("formatBody pretty-prints JSON and passes anything else through", () => {
    expect(formatBody('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatBody("not json{")).toBe("not json{");
  });

  it("clipLine leaves a short line alone and notes what it cut from a long one", () => {
    expect(clipLine("abc", 3)).toBe("abc");
    expect(clipLine("abcdef", 3)).toBe("abc… (+3 chars)");
  });

  it("layoutBody returns a small body whole", () => {
    expect(layoutBody('{"a":1}')).toEqual({
      lines: ["{", '  "a": 1', "}"],
      hiddenLines: 0,
      totalLines: 3,
    });
  });

  it("layoutBody caps the line count and reports the rest", () => {
    const body = JSON.stringify(Array.from({ length: 1000 }, (_, i) => i));
    const { lines, hiddenLines, totalLines } = layoutBody(body);
    expect(totalLines).toBe(1002);
    expect(lines).toHaveLength(MAX_BODY_LINES);
    expect(hiddenLines).toBe(1002 - MAX_BODY_LINES);
  });

  it("layoutBody clips one enormous line, e.g. an embedded base64 blob", () => {
    const blob = "x".repeat(MAX_BODY_LINE_CHARS + 50);
    const { lines } = layoutBody(JSON.stringify({ blob }));
    expect(lines[1].length).toBeLessThan(MAX_BODY_LINE_CHARS + 30);
    expect(lines[1]).toContain("chars)");
  });

  it("layoutBody applies caller-supplied caps to a raw body", () => {
    expect(layoutBody("a\nb\nc", 2, 10)).toEqual({
      lines: ["a", "b"],
      hiddenLines: 1,
      totalLines: 3,
    });
  });
});

describe("BodyLines", () => {
  it("renders a small JSON body pretty-printed with no truncation note", () => {
    const { lastFrame } = render(
      <BodyLines body='{"ok":true}' keyPrefix="b" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain('"ok": true');
    expect(frame).not.toContain("more lines not shown");
  });

  it("renders at most the cap and says how much was cut", () => {
    const body = Array.from(
      { length: MAX_BODY_LINES + 25 },
      (_, i) => `line-${i}`,
    ).join("\n");
    const { lastFrame } = render(<BodyLines body={body} keyPrefix="b" />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain(`line-${MAX_BODY_LINES - 1}`);
    expect(frame).not.toContain(`line-${MAX_BODY_LINES}\n`);
    expect(frame).toContain(
      `… 25 more lines not shown (${MAX_BODY_LINES + 25} total)`,
    );
  });
});
