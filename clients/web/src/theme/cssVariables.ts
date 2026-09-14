import type { CSSVariablesResolver } from "@mantine/core";

/**
 * Overrides for the Mantine CSS variables that `MantineProvider` injects at
 * runtime.
 *
 * These cannot be set from `App.css`: the provider appends its generated
 * `<style>` block after the stylesheet imports, so a `:root` rule there loses
 * to it on source order at equal specificity. `cssVariablesResolver` is the
 * supported seam, which is why this lives in the theme layer beside the
 * `Component.extend()` variants rather than with the `--inspector-*` tokens.
 *
 * Shared by all three `MantineProvider` sites — the app (`main.tsx`), the
 * Storybook preview, and `renderWithMantine` — so the dev app, the story
 * preview, and the tests cannot disagree about a token's value. It used to be
 * duplicated in the first two and absent from the third.
 */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    // Mantine defaults `--mantine-color-error` to `red-6`, which is 4.48:1 on
    // white — under the 4.5:1 WCAG AA threshold that applies at the 12px size
    // it renders input error text. `red-7` is 5.72:1.
    "--mantine-color-error": "var(--mantine-color-red-7)",
  },
  dark: {
    "--mantine-color-body": "var(--mantine-color-dark-9)",
    // The dark default is `red-8`, which is 1.93:1 on this body color — far
    // worse than the light-mode miss. `red-4` is 6.44:1, and is the same
    // one-to-two-step lift `App.css` already applies to the semantic
    // status/log reds for dark.
    "--mantine-color-error": "var(--mantine-color-red-4)",
  },
});
