import { useState } from 'react';
import {
  Paper,
  Button,
  TextInput,
  Badge,
  Switch,
  Textarea,
  Text,
  Stack,
  Group,
  Accordion,
  Alert,
  Code,
  CopyButton,
} from '@mantine/core';
import {
  IconChevronDown,
  IconSend,
  IconAlertTriangle,
  IconFlask,
  IconCode,
  IconCopy,
  IconCheck,
} from '@tabler/icons-react';

interface ExperimentalCapability {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  warning?: string;
}

// Mock experimental capabilities
const initialCapabilities: ExperimentalCapability[] = [
  {
    id: 'batch_requests',
    name: 'Batch Requests',
    description: 'Send multiple requests in a single batch for improved performance',
    enabled: false,
    warning: 'May not be supported by all servers',
  },
  {
    id: 'binary_content',
    name: 'Binary Content Support',
    description: 'Enable handling of binary content in resources and tool outputs',
    enabled: false,
  },
  {
    id: 'streaming_responses',
    name: 'Streaming Responses',
    description: 'Support for streaming responses from long-running operations',
    enabled: true,
  },
  {
    id: 'custom_metadata',
    name: 'Custom Metadata',
    description: 'Allow custom metadata in request/response headers',
    enabled: false,
  },
];

export function ExperimentalFeaturesPanel() {
  const [capabilities, setCapabilities] = useState(initialCapabilities);
  const [accordionValue, setAccordionValue] = useState<string[]>(['capabilities']);

  // JSON-RPC tester state
  const [method, setMethod] = useState('tools/list');
  const [params, setParams] = useState('{}');
  const [result, setResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const toggleCapability = (id: string) => {
    setCapabilities((prev) =>
      prev.map((cap) =>
        cap.id === id ? { ...cap, enabled: !cap.enabled } : cap
      )
    );
  };

  const handleSendRequest = () => {
    setIsLoading(true);
    // Simulate sending request
    setTimeout(() => {
      try {
        const parsedParams = JSON.parse(params);
        // Mock response
        const mockResponse = {
          jsonrpc: '2.0',
          id: 1,
          result: {
            _note: 'This is a mock response for demonstration',
            method,
            receivedParams: parsedParams,
            timestamp: new Date().toISOString(),
          },
        };
        setResult(JSON.stringify(mockResponse, null, 2));
      } catch {
        setResult(
          JSON.stringify(
            {
              jsonrpc: '2.0',
              id: 1,
              error: {
                code: -32700,
                message: 'Parse error',
                data: 'Invalid JSON in params',
              },
            },
            null,
            2
          )
        );
      }
      setIsLoading(false);
    }, 500);
  };

  const enabledCount = capabilities.filter((c) => c.enabled).length;

  return (
    <Stack gap="md">
      <Accordion
        multiple
        value={accordionValue}
        onChange={setAccordionValue}
        variant="separated"
        chevron={<IconChevronDown size={16} />}
      >
        {/* Experimental Capabilities Section */}
        <Accordion.Item value="capabilities">
          <Accordion.Control>
            <Group gap="sm">
              <IconFlask size={20} />
              <Text fw={500}>Experimental Capabilities</Text>
              <Badge variant="light" size="sm">
                {enabledCount}/{capabilities.length} enabled
              </Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <Alert
                color="yellow"
                icon={<IconAlertTriangle size={16} />}
                variant="light"
              >
                Experimental features may change or be removed in future versions.
                Use with caution in production environments.
              </Alert>

              <Stack gap="sm">
                {capabilities.map((cap) => (
                  <Paper key={cap.id} withBorder p="sm" radius="md">
                    <Group justify="space-between" align="flex-start">
                      <div style={{ flex: 1 }}>
                        <Group gap="xs" mb={4}>
                          <Text size="sm" fw={500}>{cap.name}</Text>
                          {cap.enabled && (
                            <Badge color="green" size="xs" variant="light">
                              Enabled
                            </Badge>
                          )}
                        </Group>
                        <Text size="sm" c="dimmed">{cap.description}</Text>
                        {cap.warning && (
                          <Group gap={4} mt={4}>
                            <IconAlertTriangle size={12} color="var(--mantine-color-yellow-5)" />
                            <Text size="xs" c="yellow">{cap.warning}</Text>
                          </Group>
                        )}
                      </div>
                      <Switch
                        checked={cap.enabled}
                        onChange={() => toggleCapability(cap.id)}
                      />
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* JSON-RPC Tester Section */}
        <Accordion.Item value="jsonrpc">
          <Accordion.Control>
            <Group gap="sm">
              <IconCode size={20} />
              <Text fw={500}>JSON-RPC Tester</Text>
              <Badge variant="outline" size="sm">
                Advanced
              </Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                Send raw JSON-RPC requests to the connected server for testing and debugging.
              </Text>

              <TextInput
                label="Method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                placeholder="e.g., tools/list, resources/read"
              />

              <Textarea
                label="Parameters (JSON)"
                value={params}
                onChange={(e) => setParams(e.target.value)}
                placeholder='{"key": "value"}'
                styles={{ input: { fontFamily: 'monospace', fontSize: '0.875rem' } }}
                minRows={4}
              />

              <Button
                onClick={handleSendRequest}
                loading={isLoading}
                fullWidth
                leftSection={<IconSend size={16} />}
              >
                {isLoading ? 'Sending...' : 'Send Request'}
              </Button>

              {result && (
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text size="sm" fw={500}>Response</Text>
                    <CopyButton value={result}>
                      {({ copied, copy }) => (
                        <Button
                          variant="subtle"
                          size="xs"
                          onClick={copy}
                          leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                        >
                          {copied ? 'Copied' : 'Copy Response'}
                        </Button>
                      )}
                    </CopyButton>
                  </Group>
                  <Code
                    block
                    style={{
                      maxHeight: '200px',
                      overflow: 'auto',
                      fontSize: '0.75rem',
                    }}
                  >
                    {result}
                  </Code>
                </Stack>
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
