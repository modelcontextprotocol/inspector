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
