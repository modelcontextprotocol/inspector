import { useState } from 'react';
import {
  IconCopy,
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconAlertTriangle,
} from '@tabler/icons-react';
import {
  Modal,
  Button,
  Card,
  TextInput,
  Select,
  Text,
  Stack,
  Group,
  Divider,
  Alert,
  Code,
} from '@mantine/core';

interface ElicitationFormField {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description?: string;
  required?: boolean;
  enum?: string[];
  default?: string | number | boolean;
}

interface ElicitationFormRequest {
  mode: 'form';
  message: string;
  schema: {
    properties: Record<string, ElicitationFormField>;
    required?: string[];
  };
  serverName: string;
}

interface ElicitationUrlRequest {
  mode: 'url';
  message: string;
  url: string;
  elicitationId: string;
  serverName: string;
}

type ElicitationRequest = ElicitationFormRequest | ElicitationUrlRequest;

interface ElicitationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'form' | 'url';
}

// Mock form mode request
const mockFormRequest: ElicitationFormRequest = {
  mode: 'form',
  message: 'Please provide your database connection details to proceed.',
  schema: {
    properties: {
      host: {
        name: 'host',
        type: 'string',
        description: 'Database hostname',
        required: true,
        default: 'localhost',
      },
      port: {
        name: 'port',
        type: 'number',
        description: 'Database port number',
        required: true,
        default: 5432,
      },
      database: {
        name: 'database',
        type: 'string',
        description: 'Database name',
      },
      sslMode: {
        name: 'sslMode',
        type: 'string',
        description: 'SSL connection mode',
        enum: ['disable', 'require', 'verify-ca', 'verify-full'],
        default: 'require',
      },
    },
    required: ['host', 'port'],
  },
  serverName: 'database-connector',
};

// Mock URL mode request
const mockUrlRequest: ElicitationUrlRequest = {
  mode: 'url',
  message: 'Please complete the OAuth authorization in your browser.',
  url: 'https://auth.example.com/oauth/authorize?client_id=abc123&redirect_uri=http://localhost:3000/callback&state=xyz789&scope=read+write',
  elicitationId: 'elicit-abc123-def456',
  serverName: 'oauth-server',
};

export function ElicitationModal({
  open,
  onOpenChange,
  mode,
}: ElicitationModalProps) {
  const request: ElicitationRequest =
    mode === 'form' ? mockFormRequest : mockUrlRequest;

  if (mode === 'form') {
    return (
      <ElicitationFormMode
        open={open}
        onOpenChange={onOpenChange}
        request={request as ElicitationFormRequest}
      />
    );
  }

  return (
    <ElicitationUrlMode
      open={open}
      onOpenChange={onOpenChange}
      request={request as ElicitationUrlRequest}
    />
  );
}

// Form Mode Component
function ElicitationFormMode({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ElicitationFormRequest;
}) {
  const [formData, setFormData] = useState<Record<string, string | number>>(() => {
    // Initialize with defaults
    const initial: Record<string, string | number> = {};
    Object.entries(request.schema.properties).forEach(([key, field]) => {
      if (field.default !== undefined) {
        initial[key] = field.default as string | number;
      }
    });
    return initial;
  });

  const handleChange = (key: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleCancel = () => {
    console.log('Elicitation cancelled - sending declined response');
    onOpenChange(false);
  };

  const handleSubmit = () => {
    console.log('Elicitation form submitted:', formData);
    onOpenChange(false);
  };

  const isRequired = (fieldName: string) =>
    request.schema.required?.includes(fieldName);

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title="Server Request: User Input Required"
      size="md"
    >
      <Stack gap="md">
        {/* Message */}
        <Text size="sm">{request.message}</Text>

        <Divider />

        {/* Form Fields */}
        <Stack gap="sm">
          {Object.entries(request.schema.properties).map(([key, field]) => (
            <div key={key}>
              {field.description && (
                <Text size="xs" c="dimmed" mb={4}>
                  {field.description}
                </Text>
              )}
              {field.enum ? (
                <Select
                  label={
                    <>
                      {field.name}
                      {isRequired(key) && <span style={{ color: 'var(--mantine-color-red-5)' }}> *</span>}
                    </>
                  }
                  value={String(formData[key] ?? '')}
                  onChange={(val) => handleChange(key, val || '')}
                  data={field.enum.map((opt) => ({ value: opt, label: opt }))}
                  placeholder={`Select ${field.name}`}
                />
              ) : (
                <TextInput
                  label={
                    <>
                      {field.name}
                      {isRequired(key) && <span style={{ color: 'var(--mantine-color-red-5)' }}> *</span>}
                    </>
                  }
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={formData[key] ?? ''}
                  onChange={(e) =>
                    handleChange(
                      key,
                      field.type === 'number'
                        ? Number(e.target.value)
                        : e.target.value
                    )
                  }
                  placeholder={`Enter ${field.name}`}
                />
              )}
            </div>
          ))}
        </Stack>

        {/* Security Warning */}
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="yellow"
          title="Warning"
        >
          Only provide information you trust this server with. The server "
          {request.serverName}" is requesting this data.
        </Alert>

        {/* Actions */}
        <Group justify="flex-end">
          <Button variant="default" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Submit</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// URL Mode Component
function ElicitationUrlMode({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ElicitationUrlRequest;
}) {
  const [copied, setCopied] = useState(false);
  const [status] = useState<'waiting' | 'completed'>('waiting');

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(request.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenInBrowser = () => {
    window.open(request.url, '_blank');
  };

  const handleCancel = () => {
    console.log('Elicitation cancelled - sending declined response');
    onOpenChange(false);
  };

  // Extract domain from URL for display
  let domain = '';
  try {
    domain = new URL(request.url).hostname;
  } catch {
    domain = 'unknown';
  }

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title="Server Request: External Action Required"
      size="md"
    >
      <Stack gap="md">
        {/* Message */}
        <Text size="sm">{request.message}</Text>

        <Divider />

        {/* URL Display */}
        <div>
          <Text size="sm" c="dimmed" mb="xs">
            The server is requesting you visit:
          </Text>
          <Card withBorder p="sm">
            <Code style={{ wordBreak: 'break-all', fontSize: '0.75rem' }}>
              {request.url}
            </Code>
          </Card>
          <Group justify="flex-end" mt="xs">
            <Button
              variant="subtle"
              size="xs"
              onClick={handleCopyUrl}
              leftSection={
                copied ? (
                  <IconCheck size={14} color="green" />
                ) : (
                  <IconCopy size={14} />
                )
              }
            >
              {copied ? 'Copied' : 'Copy URL'}
            </Button>
          </Group>
        </div>

        {/* Open in Browser Button */}
        <Group justify="center">
          <Button
            onClick={handleOpenInBrowser}
            leftSection={<IconExternalLink size={16} />}
          >
            Open in Browser
          </Button>
        </Group>

        <Divider />

        {/* Status */}
        <Group justify="space-between">
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              Status:
            </Text>
            {status === 'waiting' ? (
              <>
                <IconLoader2 size={16} className="animate-spin" />
                <Text size="sm">Waiting for completion...</Text>
              </>
            ) : (
              <Text size="sm" c="green">
                Completed
              </Text>
            )}
          </Group>
        </Group>

        {/* Elicitation ID */}
        <Text size="xs" c="dimmed">
          Elicitation ID: {request.elicitationId}
        </Text>

        {/* Domain Warning */}
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="yellow"
          title="Warning"
        >
          This will open an external URL ({domain}). Verify the domain before
          proceeding.
        </Alert>

        {/* Actions */}
        <Group justify="flex-end">
          <Button variant="default" onClick={handleCancel}>
            Cancel
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
