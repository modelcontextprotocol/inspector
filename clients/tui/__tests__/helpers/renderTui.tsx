// A drop-in replacement for ink-testing-library's `render` that strips ANSI
// styling from every frame the tests read back.
//
// Ink writes styling as escape sequences *inside* the styled run, so an
// accelerator underline splits the word it decorates: `<Text underline>I</Text>nfo`
// reaches the frame buffer as `ESC[4mI ESC[24m nfo` (without the spaces). A plain
// `expect(frame).toContain("Info")` then fails against a component that is
// rendering perfectly — and only for a developer whose shell exports
// FORCE_COLOR, since CI has no TTY and chalk emits nothing there (#2207).
//
// Making every assertion read a stripped frame fixes the whole class rather
// than the six assertions that happened to trip it, and keeps the suite
// covering the styled path instead of pinning FORCE_COLOR=0 to hide it. No test
// asserts on escape sequences; one that needs the raw bytes can reach
// `stdout.lastFrame()` on the returned instance, which is left untouched.
import { render as inkRender } from "ink-testing-library";
import stripAnsi from "strip-ansi";
import type { ReactElement } from "react";

// ink-testing-library does not export its `Instance` type.
type Instance = ReturnType<typeof inkRender>;

/** Strip ANSI styling from a frame, passing `undefined` through unchanged. */
export const stripFrameStyling = (frame: string | undefined) =>
  frame === undefined ? undefined : stripAnsi(frame);

export const render = (tree: ReactElement): Instance => {
  const instance = inkRender(tree);
  return {
    ...instance,
    lastFrame: () => stripFrameStyling(instance.lastFrame()),
    // Read through to the live array on each access — ink appends to it as the
    // component re-renders, so a copy taken here would go stale.
    get frames() {
      return instance.frames.map(stripAnsi);
    },
  };
};
