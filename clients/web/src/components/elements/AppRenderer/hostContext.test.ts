import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpUiDisplayMode } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  currentStyles,
  currentTheme,
  measureContainerDimensions,
  snapshotHostContext,
} from "./hostContext";

const COLOR_SCHEME_ATTR = "data-mantine-color-scheme";

/**
 * Build a fake CSSStyleDeclaration whose `getPropertyValue` reads from a
 * lookup table, so tests control exactly which CSS variables resolve (and to
 * what) without depending on happy-dom's custom-property resolution.
 */
function fakeComputedStyle(
  values: Record<string, string>,
): CSSStyleDeclaration {
  return {
    getPropertyValue: (name: string) => values[name] ?? "",
  } as unknown as CSSStyleDeclaration;
}

function stubComputedStyle(values: Record<string, string>) {
  vi.spyOn(window, "getComputedStyle").mockReturnValue(
    fakeComputedStyle(values),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(COLOR_SCHEME_ATTR);
});

describe("currentTheme", () => {
  it("returns the resolved dark scheme written by Mantine", () => {
    document.documentElement.setAttribute(COLOR_SCHEME_ATTR, "dark");
    expect(currentTheme()).toBe("dark");
  });

  it("returns the resolved light scheme written by Mantine", () => {
    document.documentElement.setAttribute(COLOR_SCHEME_ATTR, "light");
    expect(currentTheme()).toBe("light");
  });

  it("ignores an unrecognized attribute value and falls back", () => {
    document.documentElement.setAttribute(COLOR_SCHEME_ATTR, "sepia");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(currentTheme()).toBe("light");
  });

  it("falls back to matchMedia dark when the attribute is absent", () => {
    document.documentElement.removeAttribute(COLOR_SCHEME_ATTR);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("dark"),
    }));
    expect(currentTheme()).toBe("dark");
  });

  it("falls back to light when matchMedia does not match dark", () => {
    document.documentElement.removeAttribute(COLOR_SCHEME_ATTR);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(currentTheme()).toBe("light");
  });

  it("falls back to light when matchMedia is unavailable", () => {
    document.documentElement.removeAttribute(COLOR_SCHEME_ATTR);
    vi.stubGlobal("matchMedia", undefined);
    expect(currentTheme()).toBe("light");
  });

  it("returns light in a non-DOM environment (no document, no window)", () => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("window", undefined);
    expect(currentTheme()).toBe("light");
  });

  it("consults matchMedia when document is absent but window is present", () => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("dark"),
    }));
    expect(currentTheme()).toBe("dark");
  });
});

describe("currentStyles", () => {
  it("maps resolved Mantine tokens to spec style variables", () => {
    stubComputedStyle({
      "--mantine-color-body": "#101113",
      "--mantine-color-text": "#c9c9c9",
      "--mantine-radius-md": "0.5rem",
    });
    const styles = currentStyles();
    expect(styles).toEqual({
      variables: {
        "--color-background-primary": "#101113",
        "--color-text-primary": "#c9c9c9",
        "--border-radius-md": "0.5rem",
      },
    });
  });

  it("trims whitespace and omits variables that resolve to empty", () => {
    stubComputedStyle({
      "--mantine-color-body": "  #ffffff  ",
      "--mantine-color-text": "   ",
    });
    const styles = currentStyles();
    expect(styles?.variables?.["--color-background-primary"]).toBe("#ffffff");
    expect(styles?.variables?.["--color-text-primary"]).toBeUndefined();
  });

  it("returns undefined when nothing resolves", () => {
    stubComputedStyle({});
    expect(currentStyles()).toBeUndefined();
  });

  it("returns undefined in a non-DOM environment (no document)", () => {
    vi.stubGlobal("document", undefined);
    expect(currentStyles()).toBeUndefined();
  });

  it("returns undefined in a non-DOM environment (no window)", () => {
    vi.stubGlobal("window", undefined);
    expect(currentStyles()).toBeUndefined();
  });
});

describe("measureContainerDimensions", () => {
  it("returns whole-pixel width and height for a laid-out element", () => {
    const el = document.createElement("div");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      width: 320.6,
      height: 199.4,
    } as DOMRect);
    expect(measureContainerDimensions(el)).toEqual({ width: 321, height: 199 });
  });

  it("returns undefined for a 0x0 (unattached) element", () => {
    const el = document.createElement("div");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      width: 0,
      height: 0,
    } as DOMRect);
    expect(measureContainerDimensions(el)).toBeUndefined();
  });

  it("returns undefined when only one dimension is zero", () => {
    const el = document.createElement("div");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      width: 100,
      height: 0,
    } as DOMRect);
    expect(measureContainerDimensions(el)).toBeUndefined();
  });

  it("returns undefined when getBoundingClientRect is unavailable", () => {
    const el = {} as unknown as HTMLElement;
    expect(measureContainerDimensions(el)).toBeUndefined();
  });
});

describe("snapshotHostContext", () => {
  const MODES: readonly McpUiDisplayMode[] = ["inline", "fullscreen"];

  it("seeds theme, inline display mode, and a copied available-modes list", () => {
    document.documentElement.setAttribute(COLOR_SCHEME_ATTR, "dark");
    stubComputedStyle({});
    const context = snapshotHostContext(null, MODES);
    expect(context.theme).toBe("dark");
    expect(context.displayMode).toBe("inline");
    expect(context.availableDisplayModes).toEqual(["inline", "fullscreen"]);
    // A copy, not the caller's array.
    expect(context.availableDisplayModes).not.toBe(MODES);
    expect(context.styles).toBeUndefined();
    expect(context.containerDimensions).toBeUndefined();
  });

  it("includes styles and container dimensions when both resolve", () => {
    document.documentElement.setAttribute(COLOR_SCHEME_ATTR, "light");
    stubComputedStyle({ "--mantine-color-body": "#ffffff" });
    const container = document.createElement("div");
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      width: 640,
      height: 480,
    } as DOMRect);
    const context = snapshotHostContext(container, MODES);
    expect(context.theme).toBe("light");
    expect(context.styles).toEqual({
      variables: { "--color-background-primary": "#ffffff" },
    });
    expect(context.containerDimensions).toEqual({ width: 640, height: 480 });
  });

  it("omits container dimensions when the container has no layout box", () => {
    stubComputedStyle({});
    const container = document.createElement("div");
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      width: 0,
      height: 0,
    } as DOMRect);
    const context = snapshotHostContext(container, MODES);
    expect(context.containerDimensions).toBeUndefined();
  });
});
