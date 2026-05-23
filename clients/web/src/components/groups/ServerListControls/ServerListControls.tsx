import { Button, Group } from "@mantine/core";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
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
}

export function ServerListControls({
  compact,
  serverCount,
  onToggleList,
  onAddManually,
  onImportConfig,
  onImportServerJson,
  onExport,
}: ServerListControlsProps) {
  return (
    <Group justify="flex-end">
      {serverCount > 0 && (
        <ListToggle compact={compact} onToggle={onToggleList} />
      )}
      <Button variant="default" onClick={onExport} disabled={serverCount === 0}>
        Export
      </Button>
      <ServerAddMenu
        onAddManually={onAddManually}
        onImportConfig={onImportConfig}
        onImportServerJson={onImportServerJson}
      />
    </Group>
  );
}
