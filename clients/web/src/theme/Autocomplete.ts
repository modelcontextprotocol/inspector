import { Autocomplete } from "@mantine/core";

export const ThemeAutocomplete = Autocomplete.extend({
  defaultProps: {
    radius: "md",
    // Render a clear (×) button in the right section whenever the field
    // has a value. Autocomplete fires `onChange("")` on clear, which
    // collapses any open dropdown automatically. Per-site `clearable={false}`
    // can opt out where a clear button doesn't make sense.
    clearable: true,
  },
});
