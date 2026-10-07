import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { Text, useInput } from "ink";
import { render } from "./helpers/renderTui";
import { useListFilter } from "../src/hooks/useListFilter.js";

const tick = async () => {
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};

const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const ENTER = "\r";
const BACKSPACE = "\x7f";
const CTRL_B = "\x02";

interface Item {
  name: string;
  title?: string;
}

const items: Item[] = [
  { name: "alpha", title: "First Thing" },
  { name: "beta" },
  { name: "gamma", title: "ALPHA-ish" },
];

const fields = (item: Item) => [item.name, item.title];

/**
 * Mounts the hook behind a `useInput` the way a list tab does, and prints its
 * state as one line so a test can read every field back from the frame.
 */
function Harness({
  enabled = true,
  onEditingChange,
  onUnconsumed,
}: {
  enabled?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onUnconsumed?: (input: string) => void;
}) {
  const filter = useListFilter(items, fields, { enabled, onEditingChange });
  useInput((input, key) => {
    if (!filter.handleInput(input, key)) onUnconsumed?.(input);
  });
  return (
    <Text>
      q=[{filter.query}] editing={String(filter.editing)} active=
      {String(filter.active)} items={filter.items.map((i) => i.name).join(",")}{" "}
      indices={filter.indices.join(",")}
    </Text>
  );
}

async function type(stdin: { write: (s: string) => void }, keys: string[]) {
  for (const k of keys) {
    stdin.write(k);
    await tick();
  }
}

describe("useListFilter", () => {
  it("shows every item until a query narrows them", () => {
    const { lastFrame } = render(<Harness />);
    expect(lastFrame()).toContain("items=alpha,beta,gamma");
    expect(lastFrame()).toContain("indices=0,1,2");
    expect(lastFrame()).toContain("active=false");
  });

  it("opens on '/', narrows case-insensitively over every field, and keeps on Enter", async () => {
    const onEditingChange = vi.fn();
    const { lastFrame, stdin } = render(
      <Harness onEditingChange={onEditingChange} />,
    );
    await tick();
    await type(stdin, ["/"]);
    expect(lastFrame()).toContain("editing=true");
    expect(onEditingChange).toHaveBeenLastCalledWith(true);

    // "Alpha" matches alpha by name and gamma by its title.
    await type(stdin, ["A", "l", "p", "h", "a"]);
    expect(lastFrame()).toContain("q=[Alpha]");
    expect(lastFrame()).toContain("items=alpha,gamma");
    expect(lastFrame()).toContain("indices=0,2");
    expect(lastFrame()).toContain("active=true");

    await type(stdin, [ENTER]);
    expect(lastFrame()).toContain("editing=false");
    expect(lastFrame()).toContain("items=alpha,gamma");
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it("trims with backspace and clears on Esc", async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await tick();
    await type(stdin, ["/", "b", "x"]);
    expect(lastFrame()).toContain("items= ");
    await type(stdin, [BACKSPACE]);
    expect(lastFrame()).toContain("q=[b]");
    expect(lastFrame()).toContain("items=beta");
    await type(stdin, [ESC]);
    expect(lastFrame()).toContain("q=[]");
    expect(lastFrame()).toContain("editing=false");
    expect(lastFrame()).toContain("items=alpha,beta,gamma");
  });

  it("leaves navigation and unrelated keys to the list", async () => {
    const onUnconsumed = vi.fn();
    const { lastFrame, stdin } = render(
      <Harness onUnconsumed={onUnconsumed} />,
    );
    await tick();
    // Not editing: an ordinary letter is the list's to handle.
    await type(stdin, ["x"]);
    expect(onUnconsumed).toHaveBeenCalledWith("x");
    onUnconsumed.mockClear();

    await type(stdin, ["/"]);
    // Editing: arrows still reach the list, ctrl chords and control
    // characters are swallowed without touching the query.
    await type(stdin, [UP, CTRL_B, "\t"]);
    expect(onUnconsumed).toHaveBeenCalledTimes(1);
    expect(lastFrame()).toContain("q=[]");
    expect(lastFrame()).toContain("editing=true");
  });

  it("ignores '/' and suspends editing while the list lacks the keyboard", async () => {
    const onEditingChange = vi.fn();
    const { lastFrame, stdin, rerender } = render(
      <Harness enabled={false} onEditingChange={onEditingChange} />,
    );
    await tick();
    await type(stdin, ["/"]);
    expect(lastFrame()).toContain("editing=false");

    rerender(<Harness enabled onEditingChange={onEditingChange} />);
    await tick();
    await type(stdin, ["/"]);
    expect(onEditingChange).toHaveBeenLastCalledWith(true);

    // A modal opening (or focus moving) withdraws the report…
    rerender(<Harness enabled={false} onEditingChange={onEditingChange} />);
    await tick();
    expect(lastFrame()).toContain("editing=false");
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it("withdraws the editing report when the list unmounts mid-query", async () => {
    const onEditingChange = vi.fn();
    const { stdin, unmount } = render(
      <Harness onEditingChange={onEditingChange} />,
    );
    await tick();
    await type(stdin, ["/"]);
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it("works without an editing listener", async () => {
    function Bare() {
      const [, force] = useState(0);
      const filter = useListFilter(items, fields, { enabled: true });
      useInput((input, key) => {
        filter.handleInput(input, key);
        force((n) => n + 1);
      });
      return <Text>editing={String(filter.editing)}</Text>;
    }
    const { lastFrame, stdin } = render(<Bare />);
    await tick();
    await type(stdin, ["/"]);
    expect(lastFrame()).toContain("editing=true");
    await type(stdin, [ENTER]);
    expect(lastFrame()).toContain("editing=false");
  });
});
