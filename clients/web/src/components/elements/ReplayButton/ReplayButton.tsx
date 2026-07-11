import { ActionIcon, Tooltip } from "@mantine/core";
import { MdReplay } from "react-icons/md";

export interface ReplayButtonProps {
  /** Re-send the owning history request. */
  onReplay: () => void;
}

/**
 * Icon form of the "Replay" action, used in the compact (column) ProtocolEntry
 * layout where the text button is replaced by a replay icon sitting next to the
 * pin toggle (#1616). Matches PinToggle's subtle gray icon-button styling.
 */
export function ReplayButton({ onReplay }: ReplayButtonProps) {
  return (
    <Tooltip label="Replay">
      <ActionIcon
        variant="subtle"
        color="gray"
        size="md"
        aria-label="Replay"
        onClick={onReplay}
      >
        <MdReplay size={18} />
      </ActionIcon>
    </Tooltip>
  );
}
