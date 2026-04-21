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
import type { Root } from "@modelcontextprotocol/sdk/types.js";

export type RootDraft = { name: string; uri: string };

export interface RootsTableProps {
  roots: Root[];
  newRootDraft: RootDraft;
  onRemoveRoot: (uri: string) => void;
  onNewRootDraftChange: (draft: RootDraft) => void;
  onAddRoot: () => void;
  onBrowse: () => void;
}

const HintText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const RemoveIcon = ActionIcon.withProps({
  color: "red",
  variant: "subtle",
});

const AddRootButton = Button.withProps({
  variant: "light",
  fullWidth: true,
});

export function RootsTable({
  roots,
  newRootDraft,
  onRemoveRoot,
  onNewRootDraftChange,
  onAddRoot,
  onBrowse,
}: RootsTableProps) {
  return (
    <Stack gap="md">
      <Title order={4}>Roots Configuration</Title>
      <HintText>Filesystem roots exposed to the connected server:</HintText>

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
                  <RemoveIcon onClick={() => onRemoveRoot(root.uri)}>
                    X
                  </RemoveIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <AddRootButton onClick={onAddRoot}>+ Add Root</AddRootButton>

      <Divider />

      <Title order={5}>Add New Root:</Title>
      <TextInput
        label="Name"
        value={newRootDraft.name}
        onChange={(e) =>
          onNewRootDraftChange({
            ...newRootDraft,
            name: e.currentTarget.value,
          })
        }
      />
      <TextInput
        label="URI"
        value={newRootDraft.uri}
        onChange={(e) =>
          onNewRootDraftChange({
            ...newRootDraft,
            uri: e.currentTarget.value,
          })
        }
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
