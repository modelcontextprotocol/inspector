import { Button, Group } from "@mantine/core";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import { PinColumnButton } from "../../elements/PinColumnButton/PinColumnButton";
import {
  ServerAddMenu,
  type AddServerMenuProps,
} from "../ServerAddMenu/ServerAddMenu.js";

export interface ServerListControlsProps extends AddServerMenuProps {
  compact: boolean;
  serverCount: number;
  onToggleList: () => void;
  /** Download the current server list as a canonical `mcp.json` file. */
  onExport: () => void;
  /** When false (read-only session), the Add menu is hidden. Defaults to true. */
  writable?: boolean;
  /**
   * Open the monitoring column. Provided (by the caller) only when a server is
   * connected, the column can open, and it isn't already shown — otherwise
   * omitted so the open-sidebar affordance is hidden.
   */
  onOpenMonitor?: () => void;
}

export function ServerListControls({
  compact,
  serverCount,
  onToggleList,
  onAddManually,
  onImportConfig,
  onImportServerJson,
  onExport,
  writable = true,
  onOpenMonitor,
}: ServerListControlsProps) {
  return (
    // `gap="sm"` matches the header's control spacing (its RightSection group),
    // so these buttons sit the same distance apart as the header icons.
    <Group justify="flex-end" gap="sm">
      <Button variant="default" onClick={onExport} disabled={serverCount === 0}>
        Export
      </Button>
      {writable && (
        <ServerAddMenu
          onAddManually={onAddManually}
          onImportConfig={onImportConfig}
          onImportServerJson={onImportServerJson}
        />
      )}
      {serverCount > 0 && (
        <ListToggle compact={compact} onToggle={onToggleList} />
      )}
      {onOpenMonitor && (
        <PinColumnButton onPin={onOpenMonitor} label="Open monitoring column" />
      )}
    </Group>
  );
}
