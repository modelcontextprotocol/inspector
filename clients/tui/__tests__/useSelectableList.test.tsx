import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Text, useInput } from "ink";
import {
  useSelectableList,
  type UseSelectableListOptions,
} from "../src/hooks/useSelectableList.js";

/** Let ink flush an async stdin keypress / re-render before asserting. */
const tick = async () => {
  // Flush several macrotask cycles so an effect -> setState -> re-render chain
  // settles before assertions, even on slow/loaded CI (a single tick can race).
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};

/**
 * Harness that surfaces the hook's state as rendered text and forwards
 * keypresses to setSelection so the hook can be driven from a test.
 * Pressing a digit (0-9) selects that index; "x" selects index 99.
 */
function Harness({
  itemCount,
  visibleCount,
  options,
}: {
  itemCount: number;
  visibleCount: number;
  options?: UseSelectableListOptions;
}) {
  const { selectedIndex, firstVisible, setSelection } = useSelectableList(
    itemCount,
    visibleCount,
    options,
  );
  useInput((input) => {
    if (input === "x") setSelection(99);
    else if (/^[0-9]$/.test(input)) setSelection(Number(input));
  });
  return (
    <Text>
      sel={selectedIndex} first={firstVisible}
    </Text>
  );
}

describe("useSelectableList", () => {
  it("starts at index 0 with firstVisible 0", () => {
    const { lastFrame } = render(<Harness itemCount={10} visibleCount={5} />);
    expect(lastFrame()).toBe("sel=0 first=0");
  });

  it("keeps firstVisible when selecting within the visible window", async () => {
    const { lastFrame, stdin } = render(
      <Harness itemCount={10} visibleCount={5} />,
    );
    stdin.write("3");
    await tick();
    expect(lastFrame()).toBe("sel=3 first=0");
  });

  it("scrolls firstVisible forward when selection passes the window end", async () => {
    const { lastFrame, stdin } = render(
      <Harness itemCount={10} visibleCount={5} />,
    );
    stdin.write("6");
    await tick();
    // selected >= first + visibleCount => first = 6 - 5 + 1 = 2
    expect(lastFrame()).toBe("sel=6 first=2");
  });

  it("scrolls firstVisible backward when selection moves before the window", async () => {
    const { lastFrame, stdin } = render(
      <Harness itemCount={10} visibleCount={5} />,
    );
    stdin.write("8"); // first becomes 4
    await tick();
    expect(lastFrame()).toBe("sel=8 first=4");
    stdin.write("2"); // selected < first => first = selected = 2
    await tick();
    expect(lastFrame()).toBe("sel=2 first=2");
  });

  it("resets selection to 0 when resetWhen changes", async () => {
    const { lastFrame, stdin, rerender } = render(
      <Harness itemCount={10} visibleCount={5} options={{ resetWhen: "a" }} />,
    );
    stdin.write("7");
    await tick();
    expect(lastFrame()).toBe("sel=7 first=3");
    rerender(
      <Harness itemCount={10} visibleCount={5} options={{ resetWhen: "b" }} />,
    );
    await tick();
    expect(lastFrame()).toBe("sel=0 first=0");
  });

  it("does not reset when resetWhen is undefined", async () => {
    const { lastFrame, stdin, rerender } = render(
      <Harness itemCount={10} visibleCount={5} />,
    );
    stdin.write("4");
    await tick();
    rerender(<Harness itemCount={10} visibleCount={5} />);
    await tick();
    expect(lastFrame()).toBe("sel=4 first=0");
  });

  it("clamps selection when the list shrinks below the selected index", async () => {
    const { lastFrame, stdin, rerender } = render(
      <Harness itemCount={10} visibleCount={5} />,
    );
    stdin.write("8");
    await tick();
    expect(lastFrame()).toBe("sel=8 first=4");
    rerender(<Harness itemCount={3} visibleCount={5} />);
    await tick();
    // itemCount > 0 && selected >= itemCount => newIndex = 2, first clamps to 2
    expect(lastFrame()).toBe("sel=2 first=2");
  });

  it("does not clamp when the list is empty", async () => {
    const { lastFrame, stdin, rerender } = render(
      <Harness itemCount={10} visibleCount={5} />,
    );
    stdin.write("8");
    await tick();
    rerender(<Harness itemCount={0} visibleCount={5} />);
    await tick();
    // itemCount === 0 => no clamp, selection retained
    expect(lastFrame()).toBe("sel=8 first=4");
  });
});
