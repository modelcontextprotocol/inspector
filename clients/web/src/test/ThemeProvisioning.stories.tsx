import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Button, Text } from "@mantine/core";

/**
 * A guard story, not a component demo (#1898).
 *
 * The Storybook vitest project used to load a `setProjectAnnotations` setup
 * file; since Storybook 10.3 `@storybook/addon-vitest` provisions the preview
 * annotations itself, so the file was redundant and printed a notice on every
 * run. Deleting it is only safe if the annotations really do arrive by
 * themselves — and the failure mode if they don't is silent: every story would
 * render outside `.storybook/preview.tsx`'s `MantineProvider`, unstyled, and
 * would very likely still pass, because play functions assert on text and roles
 * rather than on styling.
 *
 * So this story asserts the provider is there, from angles an unthemed render
 * fails on:
 *
 * - the Mantine CSS custom properties exist on `:root` (they are emitted by the
 *   provider, not by the stylesheet import),
 * - a Mantine component resolves a real color from the theme instead of
 *   falling back to the UA default,
 * - and — the part that pins it to *this project's* preview rather than any
 *   `MantineProvider` — in dark mode `--mantine-color-body` carries the value
 *   `preview.tsx`'s `cssVariablesResolver` assigns it. A stock provider defines
 *   that variable too, just not as `dark-9`, so only the dark-mode story can
 *   tell the two apart.
 */
const meta: Meta = {
  title: "Test/ThemeProvisioning",
};

export default meta;
type Story = StoryObj;

/** Reads a custom property off the element the provider writes them to. */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

export const MantineProviderIsProvisioned: Story = {
  render: () => (
    <Button color="blue" data-testid="themed-button">
      <Text data-testid="themed-text">Themed</Text>
    </Button>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // 1. The provider emitted its variables. Importing `@mantine/core/styles.css`
    //    alone does not define these — `MantineProvider` does.
    expect(cssVar("--mantine-color-blue-6")).not.toBe("");
    expect(cssVar("--mantine-primary-color-filled")).not.toBe("");

    // 2. The theme reaches an actual component. An unstyled `<button>` renders
    //    with the UA's transparent/greyscale background, never a resolved
    //    Mantine color variable. (Which provider it is, is step 3's job — see
    //    the dark-mode story below.)
    const button = await canvas.findByTestId("themed-button");
    const background = getComputedStyle(button).backgroundColor;
    expect(background).not.toBe("");
    expect(background).not.toBe("transparent");
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
  },
};

/**
 * The discriminating half of the guard. Step 1 above passes under *any*
 * `MantineProvider`, so on its own it would not notice the preview being
 * replaced by a default one. `.storybook/preview.tsx` passes a
 * `cssVariablesResolver` that maps the dark-scheme `--mantine-color-body` onto
 * `--mantine-color-dark-9`; stock Mantine uses a different shade. Asserting the
 * two variables are equal therefore fails for a stock provider as well as for
 * no provider at all.
 */
export const PreviewResolverIsProvisioned: Story = {
  globals: { colorScheme: "dark" },
  render: () => <Text>Dark</Text>,
  play: async () => {
    const body = cssVar("--mantine-color-body");
    const dark9 = cssVar("--mantine-color-dark-9");

    expect(dark9).not.toBe("");
    // Custom properties are substituted at computed-value time, so the resolver's
    // `var(--mantine-color-dark-9)` reads back as the color itself.
    expect(body).toBe(dark9);
  },
};
