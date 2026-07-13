import { ScrollArea } from "@mantine/core";

/**
 * Auto-hiding scrollbars everywhere. `type="scroll"` shows the scrollbar only
 * while the user is actively scrolling and fades it out afterward, rather than
 * Mantine's default `"hover"` (on pointer hover) or a persistent `"auto"` bar.
 * This is a deliberate product choice — a cleaner resting state — that overrides
 * the a11y default of an always-visible scrollbar. Set once here so every
 * `ScrollArea` / `ScrollArea.Autosize` in the app behaves the same without each
 * call site repeating `type`.
 */
export const ThemeScrollArea = ScrollArea.extend({
  defaultProps: { type: "scroll" },
});

export const ThemeScrollAreaAutosize = ScrollArea.Autosize.extend({
  defaultProps: { type: "scroll" },
});
