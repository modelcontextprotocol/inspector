import { useState, useEffect } from 'react';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import {
  Modal,
  Button,
  TextInput,
  Select,
  Stack,
  Group,
  Text,
  ActionIcon,
} from '@mantine/core';

type TransportType = 'stdio' | 'http' | 'sse';

interface EnvVar {
  key: string;
  value: string;
}

export interface ServerConfig {
  id?: string;
  name: string;
  transport: TransportType;
  command?: string;
  url?: string;
  env: Record<string, string>;
}

interface AddServerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server?: ServerConfig;
  onSave: (config: ServerConfig) => void;
}

export function AddServerModal({
  open,
  onOpenChange,
  server,
  onSave,
}: AddServerModalProps) {
  const isEditMode = !!server;

  const [name, setName] = useState('');
  const [transport, setTransport] = useState<TransportType>('stdio');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);

  // Reset form when modal opens/closes or server changes
  useEffect(() => {
    if (open && server) {
      setName(server.name);
      setTransport(server.transport);
      setCommand(server.command || '');
      setUrl(server.url || '');
      setEnvVars(
        Object.entries(server.env || {}).map(([key, value]) => ({
          key,
          value,
        }))
      );
    } else if (open && !server) {
      setName('');
      setTransport('stdio');
      setCommand('');
      setUrl('');
      setEnvVars([]);
    }
  }, [open, server]);

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const removeEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const updateEnvVar = (
    index: number,
    field: 'key' | 'value',
    value: string
  ) => {
    const updated = [...envVars];
    updated[index][field] = value;
    setEnvVars(updated);
  };

  const handleSave = () => {
    const env: Record<string, string> = {};
    envVars.forEach(({ key, value }) => {
      if (key.trim()) {
        env[key.trim()] = value;
      }
    });

    const config: ServerConfig = {
      id: server?.id,
      name: name.trim(),
      transport,
      env,
    };

    if (transport === 'stdio') {
      config.command = command.trim();
    } else {
      config.url = url.trim();
    }

    onSave(config);
    onOpenChange(false);
  };

  const isValid = () => {
    if (!name.trim()) return false;
    if (transport === 'stdio' && !command.trim()) return false;
    if ((transport === 'http' || transport === 'sse') && !url.trim())
      return false;
    return true;
  };

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title={isEditMode ? 'Edit Server' : 'Add Server'}
      size="md"
    >
      <Stack gap="md">
        {/* Server Name */}
        <TextInput
          label="Server Name"
          placeholder="my-mcp-server"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        {/* Transport Type */}
        <Select
          label="Transport Type"
          value={transport}
          onChange={(v) => setTransport(v as TransportType)}
          data={[
            { value: 'stdio', label: 'STDIO' },
            { value: 'http', label: 'HTTP' },
            { value: 'sse', label: 'SSE' },
          ]}
          required
        />

        {/* Command (for STDIO) */}
        {transport === 'stdio' && (
          <TextInput
            label="Command"
            placeholder="npx -y @modelcontextprotocol/server-everything"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            description="The command to run the MCP server"
            required
          />
        )}

        {/* URL (for HTTP/SSE) */}
        {(transport === 'http' || transport === 'sse') && (
          <TextInput
            label="Server URL"
            placeholder="https://api.example.com/mcp"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        )}

        {/* Environment Variables */}
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm" fw={500}>Environment Variables</Text>
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={addEnvVar}
            >
              Add
            </Button>
          </Group>
          {envVars.length === 0 ? (
            <Text size="sm" c="dimmed">
              No environment variables configured
            </Text>
          ) : (
            <Stack gap="xs">
              {envVars.map((env, index) => (
                <Group key={index} gap="xs">
                  <TextInput
                    placeholder="KEY"
                    value={env.key}
                    onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <TextInput
                    placeholder="value"
                    value={env.value}
                    onChange={(e) =>
                      updateEnvVar(index, 'value', e.target.value)
                    }
                    style={{ flex: 1 }}
                  />
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => removeEnvVar(index)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>

        {/* Footer */}
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid()}>
            {isEditMode ? 'Save Changes' : 'Add Server'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
