import { useNavigate } from 'react-router-dom';
import {
  Card,
  Group,
  Text,
  Badge,
  Switch,
  ActionIcon,
  Stack,
  Code,
  Button,
  Collapse,
  Box,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { StatusIndicator, ServerStatus } from './StatusIndicator';

interface ServerCardProps {
  server: {
    id: string;
    name: string;
    version: string;
    transport: 'stdio' | 'http' | 'sse';
    command?: string;
    url?: string;
    status: ServerStatus;
    retryCount?: number;
    error?: string;
    capabilities: {
      tools: number;
      resources: number;
      prompts: number;
    } | null;
  };
}

export function ServerCard({ server }: ServerCardProps) {
  const navigate = useNavigate();
  const [showError, { toggle: toggleError }] = useDisclosure(false);

  const connectionString = server.command || server.url || '';

  const handleToggle = () => {
    if (server.status === 'connected') {
      // Would disconnect
    } else {
      // Would connect, then navigate
      navigate('/tools');
    }
  };

  return (
    <Card withBorder shadow="sm" padding="lg">
      <Stack gap="sm">
        {/* Header row */}
        <Group justify="space-between">
          <Group gap="sm">
            <Text fw={600} size="lg">
              {server.name}
            </Text>
            <Badge variant="light" size="sm">
              v{server.version}
            </Badge>
          </Group>
          <Group gap="sm">
            <StatusIndicator
              status={server.status}
              retryCount={server.retryCount}
            />
            <Switch
              checked={server.status === 'connected'}
              onChange={handleToggle}
            />
          </Group>
        </Group>

        {/* Transport badge */}
        <Badge variant="outline" size="sm" w="fit-content">
          {server.transport.toUpperCase()}
        </Badge>

        {/* Connection string */}
        <Group gap="xs">
          <Code style={{ flex: 1 }}>{connectionString}</Code>
          <ActionIcon
            variant="subtle"
            onClick={() => navigator.clipboard.writeText(connectionString)}
          >
            <Text size="xs">Copy</Text>
          </ActionIcon>
        </Group>

        {/* Error display (if failed) */}
        {server.status === 'failed' && server.error && (
          <Box>
            <Group gap="xs">
              <Text size="sm" c="red">
                [!] {server.error.slice(0, 50)}
                {server.error.length > 50 && '...'}
              </Text>
              <Button variant="subtle" size="xs" onClick={toggleError}>
                {showError ? 'Hide' : 'Show more'}
              </Button>
            </Group>
            <Collapse in={showError}>
              <Code block mt="xs">
                {server.error}
              </Code>
            </Collapse>
          </Box>
        )}

        {/* Actions row */}
        <Group justify="space-between" mt="xs">
          <Button variant="subtle" size="xs">
            Server Info
          </Button>
          <Group gap="xs">
            <Button variant="subtle" size="xs">
              Edit
            </Button>
            <Button variant="subtle" size="xs" color="red">
              Remove
            </Button>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}
