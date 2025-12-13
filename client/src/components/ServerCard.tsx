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
  Menu,
  Select,
  Anchor,
  Alert,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCopy,
  IconChevronDown,
  IconMessageCircle,
  IconForms,
  IconLink,
  IconFolder,
  IconFiles,
  IconExternalLink,
  IconAlertTriangle,
  IconSettings,
  IconKey,
} from '@tabler/icons-react';
import { StatusIndicator, ServerStatus } from './StatusIndicator';
import { ServerInfoModal } from './ServerInfoModal';
import { AddServerModal, ServerConfig } from './AddServerModal';
import { SamplingModal } from './SamplingModal';
import { ElicitationModal } from './ElicitationModal';
import { RootsConfigurationModal } from './RootsConfigurationModal';
import { ServerSettingsModal, ServerSettings } from './ServerSettingsModal';
import { OAuthDebuggerModal } from './OAuthDebuggerModal';

export type ConnectionMode = 'direct' | 'proxy';

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
    connectionMode?: ConnectionMode;
    capabilities: {
      tools: number;
      resources: number;
      prompts: number;
    } | null;
    oauth?: boolean; // Whether server uses OAuth authentication
  };
  onConnectionModeChange?: (serverId: string, mode: ConnectionMode) => void;
}

export function ServerCard({ server, onConnectionModeChange }: ServerCardProps) {
  const navigate = useNavigate();
  const [showError, { toggle: toggleError }] = useDisclosure(false);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>(
    server.connectionMode || (server.transport === 'stdio' ? 'proxy' : 'direct')
  );
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  // Client feature modal states
  const [samplingModalOpen, setSamplingModalOpen] = useState(false);
  const [elicitationModalOpen, setElicitationModalOpen] = useState(false);
  const [elicitationMode, setElicitationMode] = useState<'form' | 'url'>('form');
  const [rootsModalOpen, setRootsModalOpen] = useState(false);
  // New modal states
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [clonedConfig, setClonedConfig] = useState<ServerConfig | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [oauthDebugModalOpen, setOauthDebugModalOpen] = useState(false);

  const connectionString = server.command || server.url || '';

  const handleToggle = () => {
    if (server.status === 'connected') {
      // Would disconnect
    } else {
      // Would connect, then navigate
      navigate('/tools', { state: { server } });
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

  const handleClone = () => {
    const cloned: ServerConfig = {
      id: `${server.id}-copy-${Date.now()}`,
      name: `${server.name} (Copy)`,
      transport: server.transport,
      command: server.command,
      url: server.url,
      env: {},
    };
    setClonedConfig(cloned);
    setCloneModalOpen(true);
  };

  const handleCloneSave = (config: ServerConfig) => {
    console.log('Creating cloned server:', config);
    // TODO: Actually create the server via proxy API
    setCloneModalOpen(false);
    setClonedConfig(null);
  };

  const handleSettingsSave = (settings: ServerSettings) => {
    console.log('Saving server settings:', settings);
    // TODO: Actually save settings via proxy API
  };

  const handleConnectionModeChange = (mode: string | null) => {
    if (mode === 'direct' || mode === 'proxy') {
      setConnectionMode(mode);
      onConnectionModeChange?.(server.id, mode);
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
                    navigate('/tools', { state: { server } });
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

          {/* Transport badge and Connection Mode */}
          <Group gap="sm">
            <Badge variant="outline" size="sm">
              {server.transport.toUpperCase()}
            </Badge>
            <Select
              size="xs"
              value={connectionMode}
              onChange={handleConnectionModeChange}
              data={[
                { value: 'direct', label: 'Direct' },
                { value: 'proxy', label: 'Via Proxy' },
              ]}
              w={120}
            />
          </Group>

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
            <Alert
              color="red"
              variant="light"
              icon={<IconAlertTriangle size={16} />}
              styles={{
                root: { padding: '12px' },
              }}
            >
              <Stack gap="xs">
                <Text size="sm" c="red">
                  {server.error.slice(0, 100)}
                  {server.error.length > 100 && '...'}
                </Text>
                <Group justify="space-between">
                  <Button
                    variant="subtle"
                    size="xs"
                    onClick={toggleError}
                  >
                    {showError ? 'Hide details' : 'Show more'}
                  </Button>
                  <Anchor
                    href="https://modelcontextprotocol.io/docs/troubleshooting"
                    target="_blank"
                    rel="noopener noreferrer"
                    size="xs"
                    c="dimmed"
                  >
                    <Group gap={4}>
                      View Troubleshooting Guide
                      <IconExternalLink size={12} />
                    </Group>
                  </Anchor>
                </Group>
                <Collapse in={showError}>
                  <Code block style={{ maxHeight: '128px', overflow: 'auto' }}>
                    {server.error}
                  </Code>
                </Collapse>
              </Stack>
            </Alert>
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
              <Button
                variant="subtle"
                size="xs"
                onClick={() => setSettingsModalOpen(true)}
                leftSection={<IconSettings size={14} />}
              >
                Settings
              </Button>
              {/* OAuth Debug button - only for OAuth-enabled servers */}
              {server.oauth && (
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => setOauthDebugModalOpen(true)}
                  leftSection={<IconKey size={14} />}
                >
                  OAuth Debug
                </Button>
              )}
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
                onClick={handleClone}
                leftSection={<IconFiles size={14} />}
              >
                Clone
              </Button>
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
      {clonedConfig && (
        <AddServerModal
          open={cloneModalOpen}
          onOpenChange={(open) => {
            setCloneModalOpen(open);
            if (!open) setClonedConfig(null);
          }}
          server={clonedConfig}
          onSave={handleCloneSave}
        />
      )}
      <ServerSettingsModal
        open={settingsModalOpen}
        onOpenChange={setSettingsModalOpen}
        serverName={server.name}
        onSave={handleSettingsSave}
      />
      <OAuthDebuggerModal
        open={oauthDebugModalOpen}
        onOpenChange={setOauthDebugModalOpen}
        serverName={server.name}
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
