import { useState } from 'react';
import {
  Card,
  Stack,
  Group,
  Text,
  Badge,
  TextInput,
  Select,
  Button,
  Alert,
  Code,
  Loader,
} from '@mantine/core';
import {
  IconForms,
  IconExternalLink,
  IconCopy,
  IconCheck,
  IconAlertTriangle,
  IconX,
} from '@tabler/icons-react';
import type {
  ElicitationFormRequest,
  ElicitationUrlRequest,
  ElicitationRequest,
} from '@modelcontextprotocol/inspector-core';

interface ElicitationRequestCardProps {
  request: ElicitationRequest;
  requestId: string;
  position: { current: number; total: number };
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
}

export function ElicitationRequestCard({
  request,
  position,
  onSubmit,
  onCancel,
}: ElicitationRequestCardProps) {
  if (request.mode === 'form') {
    return (
      <ElicitationFormCard
        request={request}
        position={position}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );
  }

  return (
    <ElicitationUrlCard
      request={request}
      position={position}
      onCancel={onCancel}
    />
  );
}

// Form Mode Card
function ElicitationFormCard({
  request,
  position,
  onSubmit,
  onCancel,
}: {
  request: ElicitationFormRequest;
  position: { current: number; total: number };
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState<Record<string, string | number>>(
    () => {
      // Initialize with defaults
      const initial: Record<string, string | number> = {};
      Object.entries(request.schema.properties).forEach(([key, field]) => {
        if (field.default !== undefined) {
          initial[key] = field.default as string | number;
        }
      });
      return initial;
    }
  );

  const handleChange = (key: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = () => {
    onSubmit(formData);
  };

  const isRequired = (fieldName: string) =>
    request.schema.required?.includes(fieldName);

  return (
    <Card withBorder p="sm">
      <Stack gap="xs">
        {/* Header */}
        <Group justify="space-between">
          <Group gap="xs">
            <IconForms size={16} />
            <Text size="sm" fw={500}>
              elicitation/create (form)
            </Text>
          </Group>
          <Badge variant="outline" size="sm">
            {position.current} of {position.total}
          </Badge>
        </Group>

        {/* Message */}
        <Text size="xs" c="dimmed">
          {request.message}
        </Text>

        {/* Form Fields - Compact Grid */}
        <Group grow gap="xs" align="flex-start">
          {Object.entries(request.schema.properties)
            .slice(0, 3)
            .map(([key, field]) => (
              <div key={key}>
                {field.enum ? (
                  <Select
                    label={
                      <Text size="xs">
                        {field.name}
                        {isRequired(key) && (
                          <Text span c="red">
                            {' '}
                            *
                          </Text>
                        )}
                      </Text>
                    }
                    size="xs"
                    value={String(formData[key] ?? '')}
                    onChange={(val) => handleChange(key, val || '')}
                    data={field.enum.map((opt) => ({ value: opt, label: opt }))}
                    placeholder={`Select`}
                  />
                ) : (
                  <TextInput
                    label={
                      <Text size="xs">
                        {field.name}
                        {isRequired(key) && (
                          <Text span c="red">
                            {' '}
                            *
                          </Text>
                        )}
                      </Text>
                    }
                    size="xs"
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
                    placeholder={field.description || `Enter ${field.name}`}
                  />
                )}
              </div>
            ))}
        </Group>

        {/* Show remaining fields if more than 3 */}
        {Object.keys(request.schema.properties).length > 3 && (
          <Group grow gap="xs" align="flex-start">
            {Object.entries(request.schema.properties)
              .slice(3)
              .map(([key, field]) => (
                <div key={key}>
                  {field.enum ? (
                    <Select
                      label={
                        <Text size="xs">
                          {field.name}
                          {isRequired(key) && (
                            <Text span c="red">
                              {' '}
                              *
                            </Text>
                          )}
                        </Text>
                      }
                      size="xs"
                      value={String(formData[key] ?? '')}
                      onChange={(val) => handleChange(key, val || '')}
                      data={field.enum.map((opt) => ({
                        value: opt,
                        label: opt,
                      }))}
                      placeholder={`Select`}
                    />
                  ) : (
                    <TextInput
                      label={
                        <Text size="xs">
                          {field.name}
                          {isRequired(key) && (
                            <Text span c="red">
                              {' '}
                              *
                            </Text>
                          )}
                        </Text>
                      }
                      size="xs"
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
                      placeholder={field.description || `Enter ${field.name}`}
                    />
                  )}
                </div>
              ))}
          </Group>
        )}

        {/* Security Warning */}
        <Alert
          icon={<IconAlertTriangle size={14} />}
          color="yellow"
          p="xs"
          styles={{ message: { fontSize: '0.75rem' } }}
        >
          Server "{request.serverName}" is requesting this data.
        </Alert>

        {/* Action buttons */}
        <Group justify="flex-end" gap="xs">
          <Button
            size="xs"
            variant="outline"
            leftSection={<IconX size={14} />}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button size="xs" onClick={handleSubmit}>
            Submit
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

// URL Mode Card
function ElicitationUrlCard({
  request,
  position,
  onCancel,
}: {
  request: ElicitationUrlRequest;
  position: { current: number; total: number };
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(request.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenInBrowser = () => {
    window.open(request.url, '_blank');
  };

  // Extract domain from URL
  let domain = '';
  try {
    domain = new URL(request.url).hostname;
  } catch {
    domain = 'unknown';
  }

  return (
    <Card withBorder p="sm">
      <Stack gap="xs">
        {/* Header */}
        <Group justify="space-between">
          <Group gap="xs">
            <IconExternalLink size={16} />
            <Text size="sm" fw={500}>
              elicitation/create (URL)
            </Text>
          </Group>
          <Badge variant="outline" size="sm">
            {position.current} of {position.total}
          </Badge>
        </Group>

        {/* Message */}
        <Text size="xs" c="dimmed">
          {request.message}
        </Text>

        {/* URL Display */}
        <Card withBorder p="xs" bg="dark.7">
          <Code
            block
            style={{
              wordBreak: 'break-all',
              fontSize: '0.7rem',
              maxHeight: '60px',
              overflow: 'auto',
            }}
          >
            {request.url}
          </Code>
        </Card>

        {/* URL Actions */}
        <Group gap="xs">
          <Button
            size="xs"
            variant="subtle"
            leftSection={
              copied ? (
                <IconCheck size={14} color="green" />
              ) : (
                <IconCopy size={14} />
              )
            }
            onClick={handleCopyUrl}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconExternalLink size={14} />}
            onClick={handleOpenInBrowser}
          >
            Open
          </Button>
        </Group>

        {/* Status */}
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            Status:
          </Text>
          <Loader size="xs" />
          <Text size="xs">Waiting for completion...</Text>
        </Group>

        {/* Domain Warning */}
        <Alert
          icon={<IconAlertTriangle size={14} />}
          color="yellow"
          p="xs"
          styles={{ message: { fontSize: '0.75rem' } }}
        >
          Opening external URL ({domain}). Verify the domain.
        </Alert>

        {/* Action buttons */}
        <Group justify="flex-end" gap="xs">
          <Button
            size="xs"
            variant="outline"
            leftSection={<IconX size={14} />}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
