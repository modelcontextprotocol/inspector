import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Container,
  Title,
  Group,
  Menu,
  Button,
  SimpleGrid,
  Card,
  TextInput,
  Text,
  Badge,
  Stack,
  Loader,
  Alert,
} from '@mantine/core';
import { IconPlugConnected, IconPlugConnectedX, IconAlertCircle, IconArrowRight } from '@tabler/icons-react';
import { ServerCard, ConnectionMode } from '../components/ServerCard';
import type { ServerDisplayModel as MockServer } from '@modelcontextprotocol/inspector-core';
import { AddServerModal, ServerConfig as AddServerConfig } from '../components/AddServerModal';
import { ImportServerJsonModal } from '../components/ImportServerJsonModal';
import { showInfoToast, showSuccessToast, showErrorToast } from '../lib/toast';
import { useMcp } from '@/context';
import { mockServers } from '@/mocks';

// NOTE: Using local state with mock data instead of storage context.
// Storage solution pending per issue #983.

export function ServerList() {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [importJsonModalOpen, setImportJsonModalOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState('http://localhost:3000/mcp');

  // Local state for servers (instead of storage context)
  const [servers, setServers] = useState<MockServer[]>(mockServers);

  // MCP connection state
  const { connect, disconnect, connectionState, serverInfo, error } = useMcp();

  const handleConnect = async () => {
    if (!serverUrl.trim()) {
      showErrorToast('Invalid URL', { description: 'Please enter a server URL' });
      return;
    }
    try {
      await connect(serverUrl);
      if (connectionState !== 'error') {
        showSuccessToast('Connected', `Connected to MCP server`);
      }
    } catch (err) {
      showErrorToast('Connection Failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
        errorType: 'connection_failed',
      });
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    showInfoToast('Disconnected', 'Disconnected from MCP server');
  };

  const handleSaveServer = (config: AddServerConfig) => {
    const newServer: MockServer = {
      id: `server-${Date.now()}`,
      name: config.name,
      version: '',
      transport: config.transport as 'http' | 'stdio',
      url: config.transport === 'http' ? config.url : undefined,
      command: config.transport === 'stdio' ? config.command : undefined,
      status: 'disconnected',
      capabilities: null,
    };
    setServers((prev) => [...prev, newServer]);
    showSuccessToast('Server Added', `Added ${config.name} to server list`);
    setAddModalOpen(false);
  };

  const handleImportServerJson = (config: {
    name: string;
    transport: string;
    command?: string;
    url?: string;
    env: Record<string, string>;
  }) => {
    const newServer: MockServer = {
      id: `server-${Date.now()}`,
      name: config.name,
      version: '',
      transport: config.transport as 'http' | 'stdio',
      url: config.url,
      command: config.command,
      status: 'disconnected',
      capabilities: null,
    };
    setServers((prev) => [...prev, newServer]);
    showSuccessToast('Server Imported', `Imported ${config.name} from server.json`);
    setImportJsonModalOpen(false);
  };

  const handleDeleteServer = (serverId: string) => {
    setServers((prev) => prev.filter((s) => s.id !== serverId));
    showInfoToast('Server Removed', 'Server removed from list');
  };

  const handleImportConfig = () => {
    showInfoToast('Import Config', 'Claude Desktop config import coming soon');
  };

  const handleConnectionModeChange = (_serverId: string, mode: ConnectionMode) => {
    showSuccessToast('Connection Mode Updated', `Server now using ${mode} connection`);
  };

  const getStatusBadge = () => {
    switch (connectionState) {
      case 'connected':
        return <Badge color="green" leftSection={<IconPlugConnected size={14} />}>Connected</Badge>;
      case 'connecting':
        return <Badge color="blue" leftSection={<Loader size={14} />}>Connecting...</Badge>;
      case 'error':
        return <Badge color="red" leftSection={<IconAlertCircle size={14} />}>Error</Badge>;
      default:
        return <Badge color="gray" leftSection={<IconPlugConnectedX size={14} />}>Disconnected</Badge>;
    }
  };

  return (
    <Container size="lg" py="xl">
      <Group justify="space-between" mb="xl">
        <Title order={1}>MCP Inspector</Title>
        <Menu shadow="md" width={200}>
          <Menu.Target>
            <Button>+ Add Server</Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => setAddModalOpen(true)}>Add manually</Menu.Item>
            <Menu.Item onClick={handleImportConfig}>Import config</Menu.Item>
            <Menu.Item onClick={() => setImportJsonModalOpen(true)}>Import server.json</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      {/* Quick Connect Panel - Direct HTTP Connection */}
      <Card withBorder mb="xl" p="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={500}>Quick Connect (Direct HTTP)</Text>
            {getStatusBadge()}
          </Group>

          <Group align="flex-end">
            <TextInput
              label="Server URL"
              placeholder="http://localhost:3000/mcp"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              style={{ flex: 1 }}
              disabled={connectionState === 'connecting' || connectionState === 'connected'}
            />
            {connectionState === 'connected' ? (
              <Button color="red" variant="outline" onClick={handleDisconnect}>
                Disconnect
              </Button>
            ) : (
              <Button
                onClick={handleConnect}
                loading={connectionState === 'connecting'}
                disabled={connectionState === 'connecting'}
              >
                Connect
              </Button>
            )}
          </Group>

          {/* Show server info when connected */}
          {serverInfo && (
            <Alert color="green" variant="light">
              <Text size="sm">
                <strong>{serverInfo.name}</strong> v{serverInfo.version}
              </Text>
              {serverInfo.instructions && (
                <Text size="xs" c="dimmed" mt={4}>{serverInfo.instructions}</Text>
              )}
              <Group gap="xs" mt="xs">
                {serverInfo.capabilities.tools && (
                  <Badge component={Link} to="/tools" size="xs" variant="outline" style={{ cursor: 'pointer' }}>
                    Tools
                  </Badge>
                )}
                {serverInfo.capabilities.resources && (
                  <Badge component={Link} to="/resources" size="xs" variant="outline" style={{ cursor: 'pointer' }}>
                    Resources
                  </Badge>
                )}
                {serverInfo.capabilities.prompts && (
                  <Badge component={Link} to="/prompts" size="xs" variant="outline" style={{ cursor: 'pointer' }}>
                    Prompts
                  </Badge>
                )}
                {serverInfo.capabilities.logging && (
                  <Badge component={Link} to="/logs" size="xs" variant="outline" style={{ cursor: 'pointer' }}>
                    Logging
                  </Badge>
                )}
              </Group>
              <Group mt="md">
                <Button component={Link} to="/tools" size="sm" rightSection={<IconArrowRight size={14} />}>
                  Go to Tools
                </Button>
              </Group>
            </Alert>
          )}

          {/* Show error when connection fails */}
          {error && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              <Text size="sm">{error.message}</Text>
            </Alert>
          )}
        </Stack>
      </Card>

      {/* Saved Servers (local state, not persisted) */}
      {servers.length > 0 && (
        <>
          <Text size="sm" c="dimmed" mb="sm">Saved Servers (session only)</Text>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
            {servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                onConnectionModeChange={handleConnectionModeChange}
                onDelete={() => handleDeleteServer(server.id)}
              />
            ))}
          </SimpleGrid>
        </>
      )}

      {/* Empty state */}
      {servers.length === 0 && (
        <Card withBorder p="xl" ta="center">
          <Text c="dimmed">No saved servers. Use "Add Server" to add one, or use Quick Connect above.</Text>
        </Card>
      )}

      <AddServerModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        onSave={handleSaveServer}
      />

      <ImportServerJsonModal
        open={importJsonModalOpen}
        onOpenChange={setImportJsonModalOpen}
        onImport={handleImportServerJson}
      />
    </Container>
  );
}
