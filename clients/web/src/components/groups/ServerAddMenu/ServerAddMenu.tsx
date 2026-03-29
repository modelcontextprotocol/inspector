import { Button, Menu } from "@mantine/core";
import { RiArrowDownSLine } from "react-icons/ri";

export interface AddServerMenuProps {
  onAddManually: () => void;
  onImportConfig: () => void;
  onImportServerJson: () => void;
}

export function ServerAddMenu({
  onAddManually,
  onImportConfig,
  onImportServerJson,
}: AddServerMenuProps) {
  const Icon = RiArrowDownSLine;
  return (
    <Menu>
      <Menu.Target>
        <Button rightSection={<Icon size={20} />}>Add Servers</Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={onAddManually}>+ Add manually</Menu.Item>
        <Menu.Item onClick={onImportConfig}>Import config</Menu.Item>
        <Menu.Item onClick={onImportServerJson}>Import server.json</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
