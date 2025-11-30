import {
  Container,
  Title,
  Group,
  Menu,
  Button,
  SimpleGrid,
} from '@mantine/core';
import { ServerCard } from '../components/ServerCard';

// Mock server data
const mockServers = [
  {
    id: 'everything-server',
    name: 'everything-server',
    version: '1.0.0',
    transport: 'stdio' as const,
    command: 'npx -y @modelcontextprotocol/server-everything',
    status: 'connected' as const,
    capabilities: { tools: 4, resources: 12, prompts: 2 },
  },
  {
    id: 'filesystem-server',
    name: 'filesystem-server',
    version: '0.6.2',
    transport: 'stdio' as const,
    command: 'npx -y @modelcontextprotocol/server-filesystem /tmp',
    status: 'disconnected' as const,
    capabilities: null,
  },
  {
    id: 'remote-server',
    name: 'remote-server',
    version: '2.1.0',
    transport: 'http' as const,
    url: 'https://api.example.com/mcp',
    status: 'failed' as const,
    retryCount: 3,
    error: 'Connection timeout after 20s',
    capabilities: null,
  },
];

export function ServerList() {
  return (
    <Container size="lg" py="xl">
      <Group justify="space-between" mb="xl">
        <Title order={1}>MCP Inspector</Title>
        <Menu shadow="md" width={200}>
          <Menu.Target>
            <Button>+ Add Server</Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item>Add manually</Menu.Item>
            <Menu.Item>Import config</Menu.Item>
            <Menu.Item>Import server.json</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {mockServers.map((server) => (
          <ServerCard key={server.id} server={server} />
        ))}
      </SimpleGrid>
    </Container>
  );
}
