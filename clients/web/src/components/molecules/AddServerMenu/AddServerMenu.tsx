import { Button, Menu } from "@mantine/core";

export interface AddServerMenuProps {
  onAddManually: () => void;
  onImportConfig: () => void;
  onImportServerJson: () => void;
}

export function AddServerMenu({
  onAddManually,
  onImportConfig,
  onImportServerJson,
}: AddServerMenuProps) {
  return (
    <Menu>
      <Menu.Target>
        <Button rightSection="&#x25BE;">+ Add Server</Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={onAddManually}>+ Add manually</Menu.Item>
        <Menu.Item onClick={onImportConfig}>Import config</Menu.Item>
        <Menu.Item onClick={onImportServerJson}>Import server.json</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
