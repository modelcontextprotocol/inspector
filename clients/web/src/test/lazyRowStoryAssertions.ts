import { expect, waitFor, within } from "storybook/test";

/**
 * Assert a long monitoring list mounts only the rows near its viewport, and
 * that scrolling reaches — and mounts — the far end (#2932). `farText` is
 * text only the last row in list order shows. Needs real layout and a real
 * `IntersectionObserver`, so it only means anything in a browser.
 */
export async function expectRowsMountNearViewport(
  canvasElement: HTMLElement,
  farText: string,
) {
  const viewport = canvasElement.querySelector(".mantine-ScrollArea-viewport");
  if (!(viewport instanceof HTMLElement)) {
    throw new Error("scroll viewport not found");
  }
  const count = (state: "mounted" | "placeholder") =>
    viewport.querySelectorAll(`[data-lazy-row="${state}"]`).length;

  // The rows in view mount; the rest hold their place without content.
  await waitFor(() => expect(count("mounted")).toBeGreaterThan(0));
  await expect(count("placeholder")).toBeGreaterThan(0);
  await expect(within(viewport).queryByText(farText)).toBeNull();

  // Scrolling to the end mounts the far row, and lets the first ones go.
  viewport.scrollTop = viewport.scrollHeight;
  await waitFor(() =>
    expect(within(viewport).getByText(farText)).toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(
      viewport.querySelector("[data-lazy-row]")?.getAttribute("data-lazy-row"),
    ).toBe("placeholder"),
  );
}
