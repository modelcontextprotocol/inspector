import { useState } from 'react';
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
  Menu,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCopy,
  IconChevronDown,
  IconMessageCircle,
  IconForms,
  IconLink,
  IconFolder,
} from '@tabler/icons-react';
import { StatusIndicator, ServerStatus } from './StatusIndicator';
import { ServerInfoModal } from './ServerInfoModal';
import { AddServerModal, ServerConfig } from './AddServerModal';
import { SamplingModal } from './SamplingModal';
import { ElicitationModal } from './ElicitationModal';
import { RootsConfigurationModal } from './RootsConfigurationModal';

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
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  // Client feature modal states
  const [samplingModalOpen, setSamplingModalOpen] = useState(false);
  const [elicitationModalOpen, setElicitationModalOpen] = useState(false);
  const [elicitationMode, setElicitationMode] = useState<'form' | 'url'>('form');
  const [rootsModalOpen, setRootsModalOpen] = useState(false);

  const connectionString = server.command || server.url || '';

  const handleToggle = () => {
    if (server.status === 'connected') {
      // Would disconnect
    } else {
      // Would connect, then navigate
      navigate('/tools');
    }
  };

  const handleEdit = (config: ServerConfig) => {
    console.log('Editing server:', config);
    // TODO: Actually update the server via proxy API
  };

  const handleRemove = () => {
    if (confirm(`Remove server "${server.name}"?`)) {
      console.log('Removing server:', server.id);
      // TODO: Actually remove the server via proxy API
    }
  };

  // Build server info for the modal
  const serverInfo = {
    name: server.name,
    version: server.version,
    protocolVersion: '2025-11-25',
    transport: server.transport,
    serverCapabilities: server.capabilities
      ? {
          tools: server.capabilities.tools,
          resources: server.capabilities.resources,
          prompts: server.capabilities.prompts,
          logging: true,
          completions: false,
          tasks: false,
          experimental: false,
        }
      : undefined,
    clientCapabilities: server.capabilities
      ? {
          sampling: true,
          elicitation: true,
          roots: 3,
          tasks: true,
          experimental: false,
        }
      : undefined,
    instructions:
      server.status === 'connected'
        ? 'This server provides testing tools for MCP development.'
        : undefined,
  };

  // Build server config for edit modal
  const serverConfig: ServerConfig = {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command,
    url: server.url,
    env: {},
  };

  return (
    <>
      <Card withBorder shadow="sm" padding="lg">
        <Stack gap="sm">
          {/* Header row */}
          <Group justify="space-between">
            <Group gap="sm">
              <Text
                fw={600}
                size="lg"
                style={{
                  cursor: server.status === 'connected' ? 'pointer' : 'default',
                }}
                onClick={() => {
                  if (server.status === 'connected') {
                    navigate('/tools');
                  }
                }}
              >
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
              <IconCopy size={16} />
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
            <Group gap="xs">
              <Button
                variant="subtle"
                size="xs"
                onClick={() => setInfoModalOpen(true)}
              >
                Server Info
              </Button>
              {/* Test Client Features dropdown - only for connected servers */}
              {server.status === 'connected' && (
                <Menu shadow="md" width={220}>
                  <Menu.Target>
                    <Button
                      variant="outline"
                      size="xs"
                      rightSection={<IconChevronDown size={14} />}
                    >
                      Test Client Features
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      leftSection={<IconMessageCircle size={14} />}
                      onClick={() => setSamplingModalOpen(true)}
                    >
                      Simulate Sampling Request
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconForms size={14} />}
                      onClick={() => {
                        setElicitationMode('form');
                        setElicitationModalOpen(true);
                      }}
                    >
                      Simulate Elicitation (Form)
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconLink size={14} />}
                      onClick={() => {
                        setElicitationMode('url');
                        setElicitationModalOpen(true);
                      }}
                    >
                      Simulate Elicitation (URL)
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconFolder size={14} />}
                      onClick={() => setRootsModalOpen(true)}
                    >
                      Configure Roots
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
            <Group gap="xs">
              <Button
                variant="subtle"
                size="xs"
                onClick={() => setEditModalOpen(true)}
              >
                Edit
              </Button>
              <Button
                variant="subtle"
                size="xs"
                color="red"
                onClick={handleRemove}
              >
                Remove
              </Button>
            </Group>
          </Group>
        </Stack>
      </Card>

      {/* Modals */}
      <ServerInfoModal
        open={infoModalOpen}
        onOpenChange={setInfoModalOpen}
        server={serverInfo}
      />
      <AddServerModal
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        server={serverConfig}
        onSave={handleEdit}
      />

      {/* Client Feature Modals */}
      <SamplingModal
        open={samplingModalOpen}
        onOpenChange={setSamplingModalOpen}
      />
      <ElicitationModal
        open={elicitationModalOpen}
        onOpenChange={setElicitationModalOpen}
        mode={elicitationMode}
      />
      <RootsConfigurationModal
        open={rootsModalOpen}
        onOpenChange={setRootsModalOpen}
      />
    </>
  );
}
