import { describe, expect, it } from "vitest";
import { act } from "react";
import { useComputedColorScheme } from "@mantine/core";
import { renderWithMantine } from "../test/renderWithMantine";
import { useThemeToggle } from "./useThemeToggle";

/**
 * Renders the hook alongside the resolved scheme, so each assertion reads what
 * the user would actually be looking at rather than what was stored.
 */
function harness(colorScheme?: "light" | "dark") {
  let toggle: (() => void) | undefined;
  let scheme = "";
  function Probe() {
    toggle = useThemeToggle().onToggleTheme;
    scheme = useComputedColorScheme("light");
    return null;
  }
  renderWithMantine(<Probe />, colorScheme ? { colorScheme } : undefined);
  return {
    scheme: () => scheme,
    toggle: () => {
      act(() => toggle?.());
    },
  };
}

describe("useThemeToggle", () => {
  it("switches a light scheme to dark", () => {
    const h = harness();
    expect(h.scheme()).toBe("light");
    h.toggle();
    expect(h.scheme()).toBe("dark");
  });

  it("switches a dark scheme back to light", () => {
    const h = harness("dark");
    expect(h.scheme()).toBe("dark");
    h.toggle();
    expect(h.scheme()).toBe("light");
  });
});
