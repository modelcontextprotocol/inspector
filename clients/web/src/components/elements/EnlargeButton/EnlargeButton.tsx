import { ActionIcon, Tooltip } from "@mantine/core";
import { ImEnlarge2 } from "react-icons/im";

export interface EnlargeButtonProps {
  /** Swap the single-line input this sits in for a multiline text area. */
  onClick: () => void;
  /**
   * Overrides the accessible name (aria-label), which defaults to the tooltip
   * text ("Enlarge"). Pass a per-field name (e.g. including the field's label)
   * when several inputs in one form each carry a button, so assistive tech can
   * tell them apart; the visible tooltip stays the plain verb.
   */
  ariaLabel?: string;
  /**
   * Mirrors the disabled state of the input this sits in. A live button on a
   * disabled field would still swap in the text area — which mounts disabled and
   * cannot take focus, dropping keyboard focus to the document.
   */
  disabled?: boolean;
}

const EnlargeActionIcon = ActionIcon.withProps({
  variant: "subtle",
  color: "gray",
  size: "sm",
  tabIndex: -1,
});

/**
 * The enlarge affordance shown to the left of a text input's ClearButton
 * (#2042). Clicking it replaces the single-line input with a multiline text
 * area, so a value containing newlines can be typed — a plain `<input>` swallows
 * Enter, which left string arguments effectively single-line.
 *
 * Deliberately not a toggle: shrinking back would have to decide what to do with
 * the newlines already typed, and either answer (silently discard them, or keep
 * a value the field can no longer display) is worse than staying enlarged.
 *
 * `tabIndex={-1}` keeps it clickable but out of the keyboard tab order, the same
 * as ClearButton (#1487) — a form's string fields each carry one, so leaving
 * them in doubled the tab stops between one field and the next (#2138).
 *
 * That is only affordable because the keyboard keeps its own way in: SchemaForm
 * binds Enter on the single-line field, which enlarges it and enters the
 * newline in one go. Nothing else is listening for that key there, and it is
 * the one a user presses trying to type the newline the field cannot hold — so
 * the gesture that fails is the gesture that fixes it. Do not take this button
 * out of the tab order anywhere that binding is absent; unlike clearing
 * (select-all, delete) there is no built-in equivalent, and multiline mode
 * would simply be unreachable by keyboard.
 */
export function EnlargeButton({
  onClick,
  ariaLabel,
  disabled,
}: EnlargeButtonProps) {
  return (
    <Tooltip label="Enlarge">
      <EnlargeActionIcon
        aria-label={ariaLabel ?? "Enlarge"}
        disabled={disabled}
        onClick={onClick}
      >
        <ImEnlarge2 size={12} />
      </EnlargeActionIcon>
    </Tooltip>
  );
}
