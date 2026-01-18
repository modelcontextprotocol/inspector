import { useState } from 'react';
import {
  IconTrash,
  IconPlus,
  IconFolderOpen,
  IconAlertTriangle,
} from '@tabler/icons-react';
import {
  Modal,
  Button,
  Card,
  TextInput,
  Text,
  Stack,
  Group,
  Table,
  ActionIcon,
  Divider,
  Alert,
} from '@mantine/core';
import { initialRoots } from '@/mocks';
import type { Root } from '@/types';

interface RootsConfigurationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RootsConfigurationModal({
  open,
  onOpenChange,
}: RootsConfigurationModalProps) {
  const [roots, setRoots] = useState<Root[]>(initialRoots);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');

  const handleRemove = (uri: string) => {
    setRoots((prev) => prev.filter((r) => r.uri !== uri));
    console.log('Roots updated - would send notifications/roots/listChanged');
  };

  const handleAdd = () => {
    if (!newName.trim() || !newPath.trim()) return;

    // Convert path to file URI
    const uri = newPath.startsWith('file:///')
      ? newPath
      : `file:///${newPath.replace(/\\/g, '/')}`;

    setRoots((prev) => [...prev, { name: newName.trim(), uri }]);
    setNewName('');
    setNewPath('');
    setShowAddForm(false);
    console.log('Roots updated - would send notifications/roots/listChanged');
  };

  const handleBrowse = () => {
    // In a real implementation, this would open a file picker
    console.log('Browse button clicked - file picker not available in mock');
  };

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title="Roots Configuration"
      size="lg"
    >
      <Stack gap="md">
        {/* Description */}
        <Text size="sm" c="dimmed">
          Filesystem roots exposed to the connected server:
        </Text>

        {/* Roots List */}
        <Card withBorder p={0}>
          {roots.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" p="md">
              No roots configured. Add a root to allow the server to access
              filesystem directories.
            </Text>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>URI</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {roots.map((root) => (
                  <Table.Tr key={root.uri}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {root.name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace' }}>
                        {root.uri}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() => handleRemove(root.uri)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Card>

        {/* Add Root Button */}
        {!showAddForm && (
          <Button
            variant="outline"
            fullWidth
            leftSection={<IconPlus size={16} />}
            onClick={() => setShowAddForm(true)}
          >
            Add Root
          </Button>
        )}

        {/* Add Form */}
        {showAddForm && (
          <>
            <Divider />

            <Stack gap="sm">
              <Text size="sm" fw={500}>
                Add New Root:
              </Text>

              <TextInput
                label="Name:"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., Downloads"
              />

              <div>
                <Text size="sm" fw={500} mb={4}>
                  Path:
                </Text>
                <Group gap="xs">
                  <TextInput
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                    placeholder="e.g., /home/user/Downloads"
                    style={{ flex: 1 }}
                  />
                  <Button
                    variant="outline"
                    leftSection={<IconFolderOpen size={16} />}
                    onClick={handleBrowse}
                  >
                    Browse
                  </Button>
                </Group>
              </div>

              <Group justify="flex-end">
                <Button
                  variant="subtle"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewName('');
                    setNewPath('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAdd}
                  disabled={!newName.trim() || !newPath.trim()}
                >
                  Add
                </Button>
              </Group>
            </Stack>
          </>
        )}

        {/* Security Warning */}
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="yellow"
          title="Warning"
        >
          Roots give the server access to these directories. Only add
          directories you trust the server to access.
        </Alert>
      </Stack>
    </Modal>
  );
}
