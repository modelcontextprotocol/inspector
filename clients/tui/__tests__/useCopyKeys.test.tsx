import React from "react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Text, useInput } from "ink";
import { render } from "./helpers/renderTui";
import {
  COPY_KEY,
  SAVE_KEY,
  copyStatusColor,
  useCopyKeys,
} from "../src/hooks/useCopyKeys.js";
import {
  OSC52_LARGE_PAYLOAD_BYTES,
  buildOsc52Sequence,
} from "../src/utils/clipboard.js";

const tick = async () => {
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};

const squashWhitespace = (s: string) => s.replace(/\s+/g, "");

/** Renders the hook's status and records whether each key was consumed. */
function Harness({
  value,
  consumed,
}: {
  value: string | undefined;
  consumed: boolean[];
}) {
  const { handleCopyKey, status } = useCopyKeys(value, "thing");
  useInput((input) => {
    consumed.push(handleCopyKey(input));
  });
  return (
    <Text>{status ? `[${status.tone}] ${status.message}` : "no status"}</Text>
  );
}

const savedPaths: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const file of savedPaths.splice(0)) {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

describe("useCopyKeys", () => {
  it("Y emits OSC 52 to stdout and reports success", async () => {
    const consumed: boolean[] = [];
    const { stdin, stdout, lastFrame } = render(
      <Harness value="hello" consumed={consumed} />,
    );
    await tick();
    stdin.write(COPY_KEY.toUpperCase());
    await tick();
    expect(stdout.frames).toContain(buildOsc52Sequence("hello"));
    expect(lastFrame()).toContain("[success] Copied thing (5 chars) via OSC");
    expect(consumed).toEqual([true]);
  });

  it("warns when the payload is large", async () => {
    const big = "x".repeat(OSC52_LARGE_PAYLOAD_BYTES);
    const { stdin, lastFrame } = render(<Harness value={big} consumed={[]} />);
    await tick();
    stdin.write(COPY_KEY);
    await tick();
    expect(lastFrame()).toContain("[warning] Sent thing");
  });

  it("W saves the value to a file and shows its path", async () => {
    // Take the path from the directory mkdtemp actually created rather than
    // parsing it out of the frame: Ink wraps the status line at the frame
    // width, and a long os.tmpdir() (macOS's /var/folders/…/T/) moves the
    // wrap to wherever it falls, so no regex over the frame is reliable (#2609).
    const mkdtemp = vi.spyOn(fs, "mkdtempSync");
    const { stdin, lastFrame } = render(
      <Harness value="saved-value" consumed={[]} />,
    );
    await tick();
    stdin.write(SAVE_KEY);
    await tick();
    const file = path.join(String(mkdtemp.mock.results[0]?.value), "value.txt");
    savedPaths.push(file);
    expect(fs.readFileSync(file, "utf8")).toBe("saved-value");
    // Compare with all whitespace removed, so a wrap anywhere in the line —
    // including mid-path — cannot fail the check.
    expect(squashWhitespace(lastFrame() ?? "")).toContain(
      squashWhitespace(`[success] Saved thing to ${file}`),
    );
  });

  it("reports a save failure (Error and non-Error)", async () => {
    const spy = vi.spyOn(fs, "mkdtempSync").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const { stdin, lastFrame } = render(<Harness value="v" consumed={[]} />);
    await tick();
    stdin.write(SAVE_KEY);
    await tick();
    expect(lastFrame()).toContain("[error] Could not save thing: disk full");

    spy.mockImplementationOnce(() => {
      throw "plain string";
    });
    stdin.write(SAVE_KEY);
    await tick();
    expect(lastFrame()).toContain("Could not save thing: plain string");
  });

  it("consumes nothing when there is no value, and ignores other keys", async () => {
    const consumed: boolean[] = [];
    const { stdin, lastFrame } = render(
      <Harness value={undefined} consumed={consumed} />,
    );
    await tick();
    stdin.write(COPY_KEY);
    await tick();
    const withValue: boolean[] = [];
    const second = render(<Harness value="v" consumed={withValue} />);
    await tick();
    second.stdin.write("q");
    await tick();
    expect(consumed).toEqual([false]);
    expect(withValue).toEqual([false]);
    expect(lastFrame()).toContain("no status");
  });

  it("clears the status when the value changes", async () => {
    const { stdin, lastFrame, rerender } = render(
      <Harness value="first" consumed={[]} />,
    );
    await tick();
    stdin.write(COPY_KEY);
    await tick();
    expect(lastFrame()).toContain("Copied thing");
    rerender(<Harness value="second" consumed={[]} />);
    await tick();
    expect(lastFrame()).toContain("no status");
  });
});

describe("copyStatusColor", () => {
  it("maps each tone to an Ink colour", () => {
    expect(copyStatusColor("success")).toBe("green");
    expect(copyStatusColor("warning")).toBe("yellow");
    expect(copyStatusColor("error")).toBe("red");
  });
});
