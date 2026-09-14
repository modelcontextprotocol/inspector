import { Button } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { theme } from "../theme/theme";

// Guard for #1898.
//
// `.storybook/vitest.setup.ts` used to call `setProjectAnnotations([...])` to
// hand the preview annotations to the Storybook vitest project. Since Storybook
// 10.3 `@storybook/addon-vitest` applies them automatically — and *skips* doing
// so when it finds a setup file that is both inside `configDir` and calls
// `setProjectAnnotations` — so that file was removed.
//
// The project does have a `setupFiles` entry again (#2323), and it is a
// different thing: `src/test/storybookSetup.ts` configures Testing Library's
// `asyncUtilTimeout` and nothing else. It satisfies *neither* half of the
// condition above — it lives outside `.storybook/` and names no annotations —
// so the automatic path is still the one in use, and this guard still asserts
// that it worked.
//
// A green suite is not evidence that the automatic path works. Two things the
// setup file used to provision are silently losable:
//
//   • `./preview`'s decorator, which wraps every story in `MantineProvider`
//     with the project theme, and its `import "../src/App.css"`, which defines
//     the `--inspector-*` tokens. Without them stories render unthemed and
//     unstyled — and would very likely still pass their play functions.
//   • `@storybook/addon-a11y/preview`, which runs axe after each play function.
//     Without it the `a11y: { test: "error" }` parameter is inert and every
//     story passes its accessibility check vacuously.
//
// The story below closes the first gap: it asserts the Mantine theme variables
// and the `App.css` tokens are actually present in the rendered document, so an
// unthemed render fails loudly rather than passing. It also asserts the preview
// `parameters` reached the story, which is the same channel the a11y parameter
// arrives on. The axe *runner* itself can't be introspected from a play
// function; it was verified out-of-band by temporarily giving a story a real
// violation and confirming the suite went red (see the PR for #1898).

// Mantine's own default when a theme pins no `primaryShade` — the value it
// falls back to when deriving `--mantine-primary-color-filled`.
const MANTINE_DEFAULT_LIGHT_PRIMARY_SHADE = 6;

// The shade Mantine derives `--mantine-primary-color-filled` from. Everything
// here is read from the theme rather than restated, so re-pinning
// `primaryShade` or repainting the palette moves the expectation with it — a
// guard that had to be edited alongside a legitimate theme change would just
// train people to edit it, which is the opposite of what it's for.
//
// The light branch is the one that matters: `./preview` renders every story
// with `defaultColorScheme="light"` and an `initialGlobals.colorScheme` of
// `"light"`. `primaryShade` is `number | { light, dark }` in Mantine's types,
// so both forms are handled.
function lightPrimaryShade(): number {
  const shade = theme.primaryShade;
  if (typeof shade === "number") return shade;
  return shade?.light ?? MANTINE_DEFAULT_LIGHT_PRIMARY_SHADE;
}

function expectedPrimaryColor(): string {
  const palette = theme.colors?.[theme.primaryColor ?? ""];
  const color = palette?.[lightPrimaryShade()];
  if (!color) throw new Error("theme is missing its primary color palette");
  return color;
}

const meta: Meta<typeof Button> = {
  title: "Meta/Preview Annotations",
  component: Button,
  args: { children: "Themed" },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const ProjectAnnotationsApplied: Story = {
  play: async ({ canvasElement, parameters }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Themed" }),
    ).toBeInTheDocument();

    const root = getComputedStyle(document.documentElement);

    // `MantineProvider` (the `./preview` decorator) injects the theme's CSS
    // variables onto `:root`. No provider, no variables.
    await expect(
      root.getPropertyValue("--mantine-primary-color-filled").trim(),
    ).toBe(expectedPrimaryColor());

    // `--inspector-brand-primary` is defined in `App.css`, which only reaches
    // the story through `./preview`'s stylesheet import — and it resolves
    // *through* the Mantine variable above, so this covers both layers.
    await expect(
      root.getPropertyValue("--inspector-brand-primary").trim(),
    ).toBe(expectedPrimaryColor());

    // The preview `parameters` merged into the story context — the same channel
    // that carries `a11y: { test: "error" }` to the a11y addon.
    await expect(parameters.a11y).toMatchObject({ test: "error" });
  },
};
