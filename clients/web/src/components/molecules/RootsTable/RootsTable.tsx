import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Group,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

export interface RootEntry {
  name: string;
  uri: string;
}

export interface RootsTableProps {
  roots: RootEntry[];
  newRootName: string;
  newRootPath: string;
  onRemoveRoot: (uri: string) => void;
  onNewRootNameChange: (name: string) => void;
  onNewRootPathChange: (path: string) => void;
  onAddRoot: () => void;
  onBrowse: () => void;
}

export function RootsTable({
  roots,
  newRootName,
  newRootPath,
  onRemoveRoot,
  onNewRootNameChange,
  onNewRootPathChange,
  onAddRoot,
  onBrowse,
}: RootsTableProps) {
  return (
    <Stack gap="md">
      <Title order={4}>Roots Configuration</Title>
      <Text size="sm" c="dimmed">
        Filesystem roots exposed to the connected server:
      </Text>

      {roots.length > 0 && (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>URI</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {roots.map((root) => (
              <Table.Tr key={root.uri}>
                <Table.Td>{root.name}</Table.Td>
                <Table.Td>{root.uri}</Table.Td>
                <Table.Td>
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    onClick={() => onRemoveRoot(root.uri)}
                  >
                    X
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Button variant="light" fullWidth onClick={onAddRoot}>
        + Add Root
      </Button>

      <Divider />

      <Title order={5}>Add New Root:</Title>
      <TextInput
        label="Name"
        value={newRootName}
        onChange={(e) => onNewRootNameChange(e.currentTarget.value)}
      />
      <TextInput
        label="Path"
        value={newRootPath}
        onChange={(e) => onNewRootPathChange(e.currentTarget.value)}
      />
      <Group justify="flex-end">
        <Button variant="light" onClick={onBrowse}>
          Browse
        </Button>
        <Button onClick={onAddRoot}>Add</Button>
      </Group>

      <Alert color="yellow" title="Warning">
        Roots give the server access to these directories. Only add directories
        you trust the server to access.
      </Alert>
    </Stack>
  );
}
