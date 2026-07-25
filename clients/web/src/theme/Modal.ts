import { Modal } from "@mantine/core";

/**
 * Give every Modal's built-in close button an accessible name. Mantine's
 * default `Modal` close button renders as an icon-only `<button>` with no text,
 * which fails the axe `button-name` rule. Setting it once here labels the close
 * button on every modal that uses `withCloseButton` (the default) without each
 * call site repeating `closeButtonProps`.
 */
export const ThemeModal = Modal.extend({
  defaultProps: {
    closeButtonProps: { "aria-label": "Close" },
  },
});

/**
 * Restore the fade-down open/close animation on the compound `Modal.Root` API.
 * The default `<Modal>` wrapper hardcodes `transitionProps: { transition:
 * "fade-down", duration: 200 }`, but `Modal.Root` does not inherit it — so
 * modals built from `Modal.Root` (e.g. Server/Client Settings, which need a
 * sticky `Modal.Header` + scrollable `Modal.Body`, see #1698) would otherwise
 * animate differently from every plain `<Modal>`. Setting it here keeps them
 * consistent app-wide without repeating the literal at each call site.
 */
export const ThemeModalRoot = Modal.Root.extend({
  defaultProps: {
    transitionProps: { transition: "fade-down", duration: 200 },
  },
});
