/**
 * Pins the Ink behavior #2984 bumped to v8 for: bare C0 control characters in
 * text handed to `<Text>` never reach the terminal.
 *
 * The TUI renders server-supplied strings (an elicitation message, a sampling
 * prompt, tool output) straight through `<Text>`. Ink 6 already dropped
 * cursor-movement and screen-clearing escape sequences, but wrote a bare BEL,
 * BS, VT, FF or NUL through unchanged, and passed an OSC sequence (a window
 * title change) along with them — so a connected server could ring the bell or
 * backspace over the TUI's own output. Ink 8 strips all of them. Nothing in
 * this repo does that stripping itself, so a downgrade of `ink` would reopen
 * it silently; this test is what goes red instead.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { Text } from "ink";
import { render } from "./helpers/renderTui";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const BS = String.fromCharCode(8);
const VT = String.fromCharCode(11);
const FF = String.fromCharCode(12);
const NUL = String.fromCharCode(0);

describe("ink control-character handling", () => {
  it("strips bare C0 control characters from <Text>", () => {
    const { stdout } = render(
      <Text>{`A${BEL}B${BS}C${VT}D${FF}E${NUL}F`}</Text>,
    );
    // The raw frame, not the ANSI-stripped `lastFrame()` the helper returns:
    // the assertion is about the bytes Ink would write.
    expect(stdout.lastFrame()).toBe("ABCDEF");
  });

  it("strips escape sequences that would move the cursor or retitle the window", () => {
    const { stdout } = render(
      <Text>{`A${ESC}[2JB${ESC}[5AC${ESC}]0;title${BEL}D`}</Text>,
    );
    expect(stdout.lastFrame()).toBe("ABCD");
  });
});
