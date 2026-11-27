import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { StructuredOutputPanel } from "./StructuredOutputPanel";

const nested = {
  items: [
    { id: 1, name: "Item A", tags: ["foo", "bar"] },
    { id: 2, name: "Item B", tags: ["baz"] },
  ],
  total: 2,
};

const flat = {
  temperature: 25,
  unit: "C",
  city: "San Francisco",
};

// Long enough on both counts that matter: the payload exceeds the section's max
// height (so it scrolls within it rather than pushing the rest of the result
// panel down) *and* it exceeds the read-only editor's line cap, so Ace renders
// only the rows its own viewport covers.
const large = {
  rows: Array.from({ length: 60 }, (_, index) => ({
    id: index + 1,
    label: `Row ${index + 1}`,
    value: index * 7,
  })),
  total: 60,
};

const meta: Meta<typeof StructuredOutputPanel> = {
  title: "Groups/StructuredOutputPanel",
  component: StructuredOutputPanel,
};

export default meta;
type Story = StoryObj<typeof StructuredOutputPanel>;

export const Nested: Story = {
  args: {
    structuredContent: nested,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Structured Output" }),
    ).toBeInTheDocument();
    // The section starts expanded, so the payload is visible without a click.
    // Asserted on the container's text: the JSON renders in Ace, which puts
    // each token in its own element, so no single node holds the value.
    await waitFor(() =>
      expect(canvasElement.textContent).toContain('"Item A"'),
    );
  },
};

export const Flat: Story = {
  args: {
    structuredContent: flat,
  },
};

// A payload taller than the section's cap scrolls inside it rather than
// pushing the rest of the result panel down. Asserted on the real geometry,
// so dropping `mah` (or moving it to the wrong element) fails here.
//
// It also pins the read-only editor's line cap (#2151). The Protocol and
// Network lists are not virtualized and keep every entry's payload mounted
// inside its `Collapse`, so an uncapped editor would put a whole large response
// in the DOM per entry. The two assertions below are the difference between
// "capped" and "truncated": the full payload is in the *document*, and only
// part of it is in the *DOM*.
export const Large: Story = {
  args: {
    structuredContent: large,
  },
  play: async ({ canvasElement }) => {
    const editorNode = await waitFor(() => {
      const node = canvasElement.querySelector(".ace_editor");
      if (!node) throw new Error("JSON editor not mounted");
      return node as HTMLElement & { env: { editor: { getValue(): string } } };
    });

    // Nothing is lost: the last row is in the document the editor holds, so it
    // is reachable by scrolling, folding, and the copy button.
    await expect(editorNode.env.editor.getValue()).toContain('"Row 60"');
    // …and it is not rendered, which is the virtualization the cap buys.
    await expect(canvasElement.textContent).not.toContain('"Row 60"');

    const viewport = canvasElement.querySelector(
      ".mantine-ScrollArea-viewport",
    );
    if (!(viewport instanceof HTMLElement)) {
      throw new Error("scroll viewport not found");
    }
    // Capped: the visible height stays at the section's `mah`, well under the
    // payload's natural height…
    await expect(viewport.clientHeight).toBeLessThanOrEqual(400);
    // …and the overflow is reachable by scrolling rather than clipped away.
    await expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
  },
};

/** One animation frame, so layout and `ResizeObserver` delivery have run. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

// Collapsing hides the payload; expanding brings it back.
//
// Also the regression case for #3002. The editor here mounts inside a closed
// `Collapse` — `display: none`, so Ace cannot measure a character — and the
// expand is the first moment it can. Ace used to re-lay itself out from inside
// that `ResizeObserver` callback, which the browser reports as a window
// `error` ("ResizeObserver loop completed with undelivered notifications")
// and the Storybook run logged as an `[Unhandled error]` outside any test.
// Nothing failed, so nothing but this listener would notice it coming back.
export const Collapsed: Story = {
  args: {
    structuredContent: nested,
    defaultExpanded: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const resizeLoopErrors: string[] = [];
    const recordResizeLoop = (event: ErrorEvent) => {
      if (event.message.includes("ResizeObserver")) {
        resizeLoopErrors.push(event.message);
      }
    };
    window.addEventListener("error", recordResizeLoop);
    try {
      const toggle = canvas.getByRole("button", {
        name: "Expand structured output",
      });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(toggle);
      await waitFor(() =>
        expect(
          canvas.getByRole("button", { name: "Collapse structured output" }),
        ).toHaveAttribute("aria-expanded", "true"),
      );
      await waitFor(() =>
        expect(canvasElement.textContent).toContain('"Item A"'),
      );
      // The error is dispatched at the end of the frame whose layout it
      // interrupted, and the deferred re-measurement lands one frame after the
      // reveal — so two frames past the rendered text covers both.
      await nextFrame();
      await nextFrame();
      await expect(resizeLoopErrors).toEqual([]);
    } finally {
      window.removeEventListener("error", recordResizeLoop);
    }
  },
};
