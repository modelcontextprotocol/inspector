import { CloseButton } from "@mantine/core";

/**
 * The clear (×) affordance shown in a populated text input's right section
 * (`rightSection`). Wraps Mantine's `CloseButton` with a fixed
 * `aria-label="Clear"` and `tabIndex={-1}`, so the button stays mouse-clickable
 * but is skipped during keyboard tab navigation — tabbing through a form lands
 * on the next field, not on the clear button (see #1487). Pass `onClick` to
 * reset the field's value to "". Both presets can still be overridden per-site.
 */
export const ClearButton = CloseButton.withProps({
  "aria-label": "Clear",
  tabIndex: -1,
});
