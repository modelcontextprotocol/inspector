import { useState, useEffect } from 'react';
import {
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import {
  Modal,
  Button,
  TextInput,
  PasswordInput,
  NumberInput,
  Select,
  Stack,
  Group,
  Text,
  ActionIcon,
  Divider,
  SimpleGrid,
} from '@mantine/core';

type ConnectionMode = 'direct' | 'proxy';

interface KeyValuePair {
  key: string;
  value: string;
}

export interface ServerSettings {
  connectionMode: ConnectionMode;
  headers: Record<string, string>;
  metadata: Record<string, string>;
  connectionTimeout: number;
  requestTimeout: number;
  oauth?: {
    clientId: string;
    clientSecret: string;
    scopes: string;
  };
}

interface ServerSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverName: string;
  settings?: ServerSettings;
  onSave: (settings: ServerSettings) => void;
}

const defaultSettings: ServerSettings = {
  connectionMode: 'proxy',
  headers: {},
  metadata: {},
  connectionTimeout: 30000,
  requestTimeout: 60000,
};

export function ServerSettingsModal({
  open,
  onOpenChange,
  serverName,
  settings,
  onSave,
}: ServerSettingsModalProps) {
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('proxy');
  const [headers, setHeaders] = useState<KeyValuePair[]>([]);
  const [metadata, setMetadata] = useState<KeyValuePair[]>([]);
  const [connectionTimeout, setConnectionTimeout] = useState<number | string>(30000);
  const [requestTimeout, setRequestTimeout] = useState<number | string>(60000);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [scopes, setScopes] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  // Reset form when modal opens or settings change
  useEffect(() => {
    if (open) {
      const s = settings || defaultSettings;
      setConnectionMode(s.connectionMode);
      setHeaders(
        Object.entries(s.headers).map(([key, value]) => ({ key, value }))
      );
      setMetadata(
        Object.entries(s.metadata).map(([key, value]) => ({ key, value }))
      );
      setConnectionTimeout(s.connectionTimeout);
      setRequestTimeout(s.requestTimeout);
      setClientId(s.oauth?.clientId || '');
      setClientSecret(s.oauth?.clientSecret || '');
      setScopes(s.oauth?.scopes || '');
      setShowSecret(false);
    }
  }, [open, settings]);

  const addHeader = () => {
    setHeaders([...headers, { key: '', value: '' }]);
  };

  const removeHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index));
  };

  const updateHeader = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...headers];
    updated[index][field] = value;
    setHeaders(updated);
  };

  const addMetadata = () => {
    setMetadata([...metadata, { key: '', value: '' }]);
  };

  const removeMetadata = (index: number) => {
    setMetadata(metadata.filter((_, i) => i !== index));
  };

  const updateMetadata = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...metadata];
    updated[index][field] = value;
    setMetadata(updated);
  };

  const handleSave = () => {
    const headersObj: Record<string, string> = {};
    headers.forEach(({ key, value }) => {
      if (key.trim()) {
        headersObj[key.trim()] = value;
      }
    });

    const metadataObj: Record<string, string> = {};
    metadata.forEach(({ key, value }) => {
      if (key.trim()) {
        metadataObj[key.trim()] = value;
      }
    });

    const newSettings: ServerSettings = {
      connectionMode,
      headers: headersObj,
      metadata: metadataObj,
      connectionTimeout: typeof connectionTimeout === 'number' ? connectionTimeout : 30000,
      requestTimeout: typeof requestTimeout === 'number' ? requestTimeout : 60000,
    };

    // Only include OAuth if at least clientId is set
    if (clientId.trim()) {
      newSettings.oauth = {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        scopes: scopes.trim(),
      };
    }

    onSave(newSettings);
    onOpenChange(false);
  };

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title={`Server Settings: ${serverName}`}
      size="lg"
    >
      <Stack gap="md">
        {/* Connection Mode */}
        <Select
          label="Connection Mode"
          value={connectionMode}
          onChange={(v) => setConnectionMode(v as ConnectionMode)}
          data={[
            { value: 'direct', label: 'Direct' },
            { value: 'proxy', label: 'Via Proxy' },
          ]}
          description={
            connectionMode === 'direct'
              ? 'Connect directly to server (requires CORS support)'
              : 'Route through inspector proxy (required for STDIO)'
          }
        />

        <Divider />

        {/* Custom Headers */}
        <Stack gap="xs">
          <Group justify="space-between">
            <div>
              <Text size="sm" fw={500}>Custom Headers</Text>
              <Text size="xs" c="dimmed">
                Headers sent with every HTTP request to this server
              </Text>
            </div>
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={addHeader}
            >
              Add Header
            </Button>
          </Group>
          {headers.length === 0 ? (
            <Text size="sm" c="dimmed" fs="italic">
              No custom headers configured
            </Text>
          ) : (
            <Stack gap="xs">
              {headers.map((header, index) => (
                <Group key={index} gap="xs">
                  <TextInput
                    placeholder="Header-Name"
                    value={header.key}
                    onChange={(e) => updateHeader(index, 'key', e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <TextInput
                    placeholder="value"
                    value={header.value}
                    onChange={(e) => updateHeader(index, 'value', e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => removeHeader(index)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>

        <Divider />

        {/* Request Metadata */}
        <Stack gap="xs">
          <Group justify="space-between">
            <div>
              <Text size="sm" fw={500}>Request Metadata</Text>
              <Text size="xs" c="dimmed">
                Metadata sent with every MCP request to this server (included in _meta field)
              </Text>
            </div>
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={addMetadata}
            >
              Add Metadata
            </Button>
          </Group>
          {metadata.length === 0 ? (
            <Text size="sm" c="dimmed" fs="italic">
              No request metadata configured
            </Text>
          ) : (
            <Stack gap="xs">
              {metadata.map((meta, index) => (
                <Group key={index} gap="xs">
                  <TextInput
                    placeholder="key"
                    value={meta.key}
                    onChange={(e) => updateMetadata(index, 'key', e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <TextInput
                    placeholder="value"
                    value={meta.value}
                    onChange={(e) => updateMetadata(index, 'value', e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => removeMetadata(index)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>

        <Divider />

        {/* Timeouts */}
        <Stack gap="xs">
          <Text size="sm" fw={500}>Timeouts</Text>
          <SimpleGrid cols={2}>
            <NumberInput
              label="Connection Timeout"
              value={connectionTimeout}
              onChange={setConnectionTimeout}
              min={1000}
              step={1000}
              suffix=" ms"
            />
            <NumberInput
              label="Request Timeout"
              value={requestTimeout}
              onChange={setRequestTimeout}
              min={1000}
              step={1000}
              suffix=" ms"
            />
          </SimpleGrid>
        </Stack>

        <Divider />

        {/* OAuth Settings */}
        <Stack gap="xs">
          <div>
            <Text size="sm" fw={500}>OAuth Settings</Text>
            <Text size="xs" c="dimmed">
              Pre-configure OAuth credentials for servers requiring authentication
            </Text>
          </div>

          <TextInput
            label="Client ID"
            placeholder="my-client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />

          <PasswordInput
            label="Client Secret"
            placeholder="Enter client secret"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            visible={showSecret}
            onVisibilityChange={setShowSecret}
          />

          <TextInput
            label="Scopes"
            placeholder="read write profile"
            value={scopes}
            onChange={(e) => setScopes(e.target.value)}
            description="Space-separated list of OAuth scopes to request"
          />
        </Stack>

        {/* Footer */}
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Settings</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
