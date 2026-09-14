import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithMantine } from "../../../test/renderWithMantine";
import { ReAuthBannerBar } from "./ReAuthBannerBar";

describe("ReAuthBannerBar", () => {
  it("floats the banner centered above the page", () => {
    renderWithMantine(
      <ReAuthBannerBar data-testid="bar">contents</ReAuthBannerBar>,
    );
    const bar = screen.getByTestId("bar");
    expect(bar).toHaveTextContent("contents");
    expect(bar.style.transform).toBe("translate(-50%, -50%)");
    expect(bar.style.zIndex).toBe("200");
  });

  it("caps its width instead of fixing it, so a narrow viewport cannot clip its controls", () => {
    renderWithMantine(
      <ReAuthBannerBar data-testid="bar">contents</ReAuthBannerBar>,
    );
    const bar = screen.getByTestId("bar");
    // Centered by `left: 50%` plus a -50% translate, so a width wider than the
    // viewport would overflow both edges and clip the close button on one side
    // and "Authorize again" on the other (#2218).
    expect(bar.style.width).toBe("calc(100vw - 2rem)");
    expect(bar.style.maxWidth).toBe("calc(26.25rem * var(--mantine-scale))");
  });

  it("takes its centering offset from the Paper theme rather than inline styles", () => {
    renderWithMantine(
      <ReAuthBannerBar data-testid="bar">contents</ReAuthBannerBar>,
    );
    expect(screen.getByTestId("bar")).toHaveAttribute("data-variant", "reauth");
  });
});
