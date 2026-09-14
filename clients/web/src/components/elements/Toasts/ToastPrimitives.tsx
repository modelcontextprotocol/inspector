import { Anchor, List } from "@mantine/core";

// Shared "list of likely causes" styling for the warning-toast bodies.
export const ToastCauseList = List.withProps({ size: "sm", spacing: 2 });

// The "open the relevant settings/details" link rendered at the bottom of each
// warning-toast body. Same static shape across all three toasts; each passes
// its own `onClick`.
export const ToastLinkButton = Anchor.withProps({
  component: "button",
  type: "button",
  size: "sm",
});
