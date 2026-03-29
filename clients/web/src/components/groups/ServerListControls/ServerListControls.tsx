import { Group } from "@mantine/core";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import {
  ServerAddMenu,
  type AddServerMenuProps,
} from "../ServerAddMenu/ServerAddMenu.js";

export interface ServerListControlsProps extends AddServerMenuProps {
  compact: boolean;
  serverCount: number;
  onToggleList: () => void;
}

export function ServerListControls({
  compact,
  serverCount,
  onToggleList,
  onAddManually,
  onImportConfig,
  onImportServerJson,
}: ServerListControlsProps) {
  return (
    <Group justify="flex-end">
      {serverCount > 0 && (
        <ListToggle compact={compact} onToggle={onToggleList} />
      )}
      <ServerAddMenu
        onAddManually={onAddManually}
        onImportConfig={onImportConfig}
        onImportServerJson={onImportServerJson}
      />
    </Group>
  );
}
