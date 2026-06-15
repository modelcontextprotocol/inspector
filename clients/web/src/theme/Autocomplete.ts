import { Autocomplete } from "@mantine/core";

export const ThemeAutocomplete = Autocomplete.extend({
  defaultProps: {
    radius: "md",
    // Render a clear (×) button in the right section whenever the field
    // has a value. Autocomplete fires `onChange("")` on clear, which
    // collapses any open dropdown automatically. Per-site `clearable={false}`
    // can opt out where a clear button doesn't make sense.
    clearable: true,
    // Keep the clear button out of the keyboard tab order so tabbing through a
    // form moves to the next field, not onto the clear button (it stays
    // mouse-clickable).
    clearButtonProps: { tabIndex: -1 },
  },
});
