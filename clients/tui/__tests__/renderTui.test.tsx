import React from "react";
import { Text } from "ink";
import { describe, expect, it } from "vitest";
import { render, stripFrameStyling } from "./helpers/renderTui";

// The escape sequences ink emits for `<Text underline>`, spelled out here so
// the assertions hold regardless of whether the ambient environment has
// FORCE_COLOR set — chalk emits nothing without a TTY, which is exactly why
// #2207 never reproduced in CI.
const ESC = "\u001B";
const UNDERLINE_OPEN = `${ESC}[4m`;
const UNDERLINE_CLOSE = `${ESC}[24m`;
const SPLIT_WORD = `${UNDERLINE_OPEN}I${UNDERLINE_CLOSE}nfo`;

describe("stripFrameStyling", () => {
  it("removes styling that splits a word", () => {
    expect(stripFrameStyling(SPLIT_WORD)).toBe("Info");
  });

  it("leaves an unstyled frame untouched", () => {
    expect(stripFrameStyling("Info")).toBe("Info");
  });

  it("passes undefined through", () => {
    expect(stripFrameStyling(undefined)).toBeUndefined();
  });
});

describe("render", () => {
  it("strips styling from lastFrame", () => {
    const { stdout, lastFrame } = render(<Text>placeholder</Text>);
    stdout.write(SPLIT_WORD);
    expect(lastFrame()).toBe("Info");
  });

  it("strips styling from frames, and keeps reading the live array", () => {
    const instance = render(<Text>placeholder</Text>);
    const before = instance.frames.length;
    instance.stdout.write(SPLIT_WORD);
    expect(instance.frames).toHaveLength(before + 1);
    expect(instance.frames.at(-1)).toBe("Info");
  });

  it("leaves the raw bytes reachable through stdout", () => {
    const instance = render(<Text>placeholder</Text>);
    instance.stdout.write(SPLIT_WORD);
    expect(instance.stdout.lastFrame()).toBe(SPLIT_WORD);
  });

  it("still exposes the rest of the ink-testing-library instance", () => {
    const { rerender, lastFrame, unmount } = render(<Text>first</Text>);
    expect(lastFrame()).toContain("first");
    rerender(<Text>second</Text>);
    expect(lastFrame()).toContain("second");
    unmount();
  });
});
