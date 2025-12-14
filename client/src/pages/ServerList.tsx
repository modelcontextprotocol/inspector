import { useState } from 'react';
import {
  Container,
  Title,
  Group,
  Menu,
  Button,
  SimpleGrid,
} from '@mantine/core';
import { ServerCard, ConnectionMode } from '../components/ServerCard';
import { AddServerModal, ServerConfig } from '../components/AddServerModal';
import { ImportServerJsonModal } from '../components/ImportServerJsonModal';
import { showInfoToast, showSuccessToast } from '../lib/toast';
import { mockServers } from '@/mocks';

export function ServerList() {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [importJsonModalOpen, setImportJsonModalOpen] = useState(false);

  const handleSaveServer = (config: ServerConfig) => {
    console.log('New server config:', config);
    // TODO: Actually save the server config
  };

  const handleImportServerJson = (config: {
    name: string;
    transport: string;
    command?: string;
    url?: string;
    env: Record<string, string>;
  }) => {
    console.log('Imported server config:', config);
    // TODO: Actually save the imported server config
  };

  const handleImportConfig = () => {
    showInfoToast('Import Config', 'Claude Desktop config import coming soon');
  };

  // Handler for connection mode changes (demonstrates toast usage)
  const handleConnectionModeChange = (serverId: string, mode: ConnectionMode) => {
    console.log('Connection mode changed:', serverId, mode);
    showSuccessToast('Connection Mode Updated', `Server now using ${mode} connection`);
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

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {mockServers.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            onConnectionModeChange={handleConnectionModeChange}
          />
        ))}
      </SimpleGrid>

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
