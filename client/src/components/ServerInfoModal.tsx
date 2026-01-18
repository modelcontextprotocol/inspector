import { IconCopy, IconCheck, IconX } from '@tabler/icons-react';
import {
  Modal,
  Badge,
  Text,
  Title,
  Group,
  Stack,
  SimpleGrid,
  Box,
  Code,
  CopyButton,
  ActionIcon,
} from '@mantine/core';

interface ServerCapabilities {
  tools?: number;
  resources?: number;
  prompts?: number;
  logging?: boolean;
  completions?: boolean;
  tasks?: boolean;
  experimental?: boolean;
}

interface ClientCapabilities {
  sampling?: boolean;
  elicitation?: boolean;
  roots?: number;
  tasks?: boolean;
  experimental?: boolean;
}

interface OAuthDetails {
  authUrl?: string;
  scopes?: string[];
  accessToken?: string;
}

interface ServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
  transport: 'stdio' | 'http' | 'sse';
  serverCapabilities?: ServerCapabilities;
  clientCapabilities?: ClientCapabilities;
  instructions?: string;
  oauthDetails?: OAuthDetails;
}

interface ServerInfoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: ServerInfo;
}

function CapabilityItem({
  label,
  enabled,
  count,
}: {
  label: string;
  enabled?: boolean;
  count?: number;
}) {
  const isEnabled = enabled === true || (count !== undefined && count > 0);

  return (
    <Group gap="xs">
      {isEnabled ? (
        <IconCheck size={16} color="var(--mantine-color-green-6)" />
      ) : (
        <IconX size={16} color="var(--mantine-color-dimmed)" />
      )}
      <Text size="sm" c={!isEnabled ? 'dimmed' : undefined}>
        {label}
        {count !== undefined && count > 0 && ` (${count})`}
      </Text>
    </Group>
  );
}

export function ServerInfoModal({
  open,
  onOpenChange,
  server,
}: ServerInfoModalProps) {
  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title="Server Information"
      size="lg"
    >
      <Stack gap="lg">
        {/* Basic Info */}
        <SimpleGrid cols={2} spacing="sm">
          <Group gap="xs">
            <Text size="sm" c="dimmed">Name:</Text>
            <Text size="sm" fw={500}>{server.name}</Text>
          </Group>
          <Group gap="xs">
            <Text size="sm" c="dimmed">Version:</Text>
            <Text size="sm" fw={500}>{server.version}</Text>
          </Group>
          <Group gap="xs">
            <Text size="sm" c="dimmed">Protocol:</Text>
            <Text size="sm" fw={500}>{server.protocolVersion}</Text>
          </Group>
          <Group gap="xs">
            <Text size="sm" c="dimmed">Transport:</Text>
            <Badge variant="outline" size="sm">
              {server.transport.toUpperCase()}
            </Badge>
          </Group>
        </SimpleGrid>

        {/* Capabilities */}
        <SimpleGrid cols={2} spacing="xl">
          {/* Server Capabilities */}
          <Box>
            <Title order={5} pb="xs" mb="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              Server Capabilities
            </Title>
            <Stack gap="xs">
              <CapabilityItem
                label="Tools"
                count={server.serverCapabilities?.tools}
              />
              <CapabilityItem
                label="Resources"
                count={server.serverCapabilities?.resources}
              />
              <CapabilityItem
                label="Prompts"
                count={server.serverCapabilities?.prompts}
              />
              <CapabilityItem
                label="Logging"
                enabled={server.serverCapabilities?.logging}
              />
              <CapabilityItem
                label="Completions"
                enabled={server.serverCapabilities?.completions}
              />
              <CapabilityItem
                label="Tasks"
                enabled={server.serverCapabilities?.tasks}
              />
              <CapabilityItem
                label="Experimental"
                enabled={server.serverCapabilities?.experimental}
              />
            </Stack>
          </Box>

          {/* Client Capabilities */}
          <Box>
            <Title order={5} pb="xs" mb="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              Client Capabilities
            </Title>
            <Stack gap="xs">
              <CapabilityItem
                label="Sampling"
                enabled={server.clientCapabilities?.sampling}
              />
              <CapabilityItem
                label="Elicitation"
                enabled={server.clientCapabilities?.elicitation}
              />
              <CapabilityItem
                label="Roots"
                count={server.clientCapabilities?.roots}
              />
              <CapabilityItem
                label="Tasks"
                enabled={server.clientCapabilities?.tasks}
              />
              <CapabilityItem
                label="Experimental"
                enabled={server.clientCapabilities?.experimental}
              />
            </Stack>
          </Box>
        </SimpleGrid>

        {/* Server Instructions */}
        {server.instructions && (
          <Box>
            <Title order={5} pb="xs" mb="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              Server Instructions
            </Title>
            <Text size="sm" c="dimmed" fs="italic">
              "{server.instructions}"
            </Text>
          </Box>
        )}

        {/* OAuth Details */}
        {server.oauthDetails && (
          <Box>
            <Title order={5} pb="xs" mb="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              OAuth Details
            </Title>
            <Stack gap="xs">
              {server.oauthDetails.authUrl && (
                <Group gap="xs">
                  <Text size="sm" c="dimmed">Auth URL:</Text>
                  <Text size="sm">{server.oauthDetails.authUrl}</Text>
                </Group>
              )}
              {server.oauthDetails.scopes &&
                server.oauthDetails.scopes.length > 0 && (
                  <Group gap="xs">
                    <Text size="sm" c="dimmed">Scopes:</Text>
                    <Group gap={4}>
                      {server.oauthDetails.scopes.map((scope) => (
                        <Badge key={scope} variant="light" size="sm">
                          {scope}
                        </Badge>
                      ))}
                    </Group>
                  </Group>
                )}
              {server.oauthDetails.accessToken && (
                <Group gap="xs">
                  <Text size="sm" c="dimmed">Access Token:</Text>
                  <Code style={{ flex: 1, maxWidth: 200 }}>
                    {server.oauthDetails.accessToken.slice(0, 20)}...
                  </Code>
                  <CopyButton value={server.oauthDetails.accessToken}>
                    {({ copied, copy }) => (
                      <ActionIcon
                        variant="subtle"
                        onClick={copy}
                        color={copied ? 'green' : 'gray'}
                      >
                        {copied ? (
                          <IconCheck size={16} />
                        ) : (
                          <IconCopy size={16} />
                        )}
                      </ActionIcon>
                    )}
                  </CopyButton>
                </Group>
              )}
            </Stack>
          </Box>
        )}
      </Stack>
    </Modal>
  );
}
