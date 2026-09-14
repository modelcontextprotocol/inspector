import { ActionIcon, Tooltip } from "@mantine/core";
import { MdEditNote } from "react-icons/md";

export interface EditReplayButtonProps {
  /** Open the editor seeded with the owning entry's request params. */
  onClick: () => void;
}

/**
 * "Edit and replay" — the sibling of {@link ReplayButton} that stops for the
 * params instead of re-sending them verbatim (#2151).
 *
 * Same subtle gray icon-button styling as Replay and the pin toggle, so the
 * three read as one control cluster on a Protocol entry.
 */
const EditReplayActionIcon = ActionIcon.withProps({
  variant: "subtle",
  color: "gray",
  size: "md",
  "aria-label": "Edit and replay",
});

export function EditReplayButton({ onClick }: EditReplayButtonProps) {
  return (
    <Tooltip label="Edit and replay">
      <EditReplayActionIcon onClick={onClick}>
        <MdEditNote size={20} />
      </EditReplayActionIcon>
    </Tooltip>
  );
}
