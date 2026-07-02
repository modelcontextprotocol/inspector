import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";

// ScrollView: passthrough so `content` mounts and the imperative ref API
// (scrollBy / getViewportHeight) exists for the scroll-key handlers.
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import { DetailsModal } from "../src/components/DetailsModal.js";

// Ink processes stdin keypresses asynchronously — await this after stdin.write.
const tick = async () => {
  // Flush several macrotask cycles so an effect -> setState -> re-render chain
  // settles before assertions, even on slow/loaded CI (a single tick can race).
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};

const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

describe("DetailsModal", () => {
  it("renders without crashing with content", () => {
    const { unmount } = render(
      <DetailsModal
        title="Details"
        content={<Text>some content</Text>}
        width={120}
        height={30}
        onClose={() => {}}
      />,
    );
    // Modal is position="absolute" so lastFrame is empty; just confirm it
    // mounted and unmounts cleanly (running the resize cleanup effect).
    unmount();
  });

  it("handles all scroll keys via the ScrollView ref", async () => {
    const { stdin } = render(
      <DetailsModal
        title="Details"
        content={<Text>scrollable</Text>}
        width={120}
        height={30}
        onClose={() => {}}
      />,
    );

    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(UP);
    await tick();
    stdin.write(PAGE_DOWN);
    await tick();
    stdin.write(PAGE_UP);
    await tick();
  });

  it("ignores keys it does not handle", async () => {
    const onClose = vi.fn();
    const { stdin } = render(
      <DetailsModal
        title="Details"
        content={<Text>x</Text>}
        width={120}
        height={30}
        onClose={onClose}
      />,
    );

    await tick();
    // A plain character key matches none of the branches.
    stdin.write("a");
    await tick();

    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose on ESC", async () => {
    const onClose = vi.fn();
    const { stdin } = render(
      <DetailsModal
        title="Details"
        content={<Text>x</Text>}
        width={120}
        height={30}
        onClose={onClose}
      />,
    );

    await tick();
    stdin.write(ESC);
    await tick();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
