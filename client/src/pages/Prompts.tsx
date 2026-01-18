import { useState, useEffect } from 'react';
import {
  Grid,
  Card,
  Text,
  TextInput,
  Stack,
  Button,
  ScrollArea,
  Box,
  Title,
  Select,
  Loader,
  Code,
  Group,
} from '@mantine/core';
import { IconPlugConnectedX, IconAlertCircle } from '@tabler/icons-react';
import { ListChangedIndicator } from '../components/ListChangedIndicator';
import { useMcp } from '@/context';
import { useMcpPrompts } from '@/hooks';
import type { Prompt, PromptMessage } from '@modelcontextprotocol/sdk/types.js';

// NOTE: Using useMcpPrompts instead of useTrackedMcpPrompts.
// Tracked version (with history/logging) will be added in PR #3.

export function Prompts() {
  const { isConnected } = useMcp();
  const {
    prompts,
    isLoading,
    error,
    listChanged,
    getPrompt,
    refresh,
    clearListChanged,
  } = useMcpPrompts();

  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({});
  const [promptResult, setPromptResult] = useState<PromptMessage[] | null>(null);
  const [isGettingPrompt, setIsGettingPrompt] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  // Select first prompt when prompts load
  useEffect(() => {
    if (prompts.length > 0 && !selectedPrompt) {
      setSelectedPrompt(prompts[0]);
    }
  }, [prompts, selectedPrompt]);

  // Reset args when prompt selection changes
  useEffect(() => {
    setPromptArgs({});
    setPromptResult(null);
    setPromptError(null);
  }, [selectedPrompt]);

  const handleRefresh = async () => {
    await refresh();
    clearListChanged();
  };

  const handlePromptChange = (value: string | null) => {
    const prompt = prompts.find((p) => p.name === value);
    setSelectedPrompt(prompt || null);
  };

  const handleArgChange = (argName: string, value: string) => {
    setPromptArgs((prev) => ({ ...prev, [argName]: value }));
  };

  const handleGetPrompt = async () => {
    if (!selectedPrompt) return;

    setIsGettingPrompt(true);
    setPromptError(null);
    setPromptResult(null);

    try {
      const result = await getPrompt(selectedPrompt.name, promptArgs);
      setPromptResult(result.messages || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get prompt';
      setPromptError(message);
    } finally {
      setIsGettingPrompt(false);
    }
  };

  const handleCopy = () => {
    if (promptResult) {
      navigator.clipboard.writeText(JSON.stringify(promptResult, null, 2));
    }
  };

  // Get content text from a message
  const getMessageText = (message: PromptMessage): string => {
    if (!message.content) return '';

    if (typeof message.content === 'string') {
      return message.content;
    }

    // Handle content object
    const content = message.content as { type?: string; text?: string };
    if (content.type === 'text' && content.text) {
      return content.text;
    }

    return JSON.stringify(message.content);
  };

  // Show disconnected state
  if (!isConnected) {
    return (
      <Grid gutter="md" h="calc(100vh - 100px)">
        <Grid.Col span={12}>
          <Card h="100%" withBorder>
            <Stack align="center" justify="center" h="100%" gap="md">
              <IconPlugConnectedX size={48} color="gray" />
              <Title order={3} c="dimmed">Not Connected</Title>
              <Text c="dimmed">Connect to an MCP server to view prompts.</Text>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    );
  }

  // Show loading state
  if (isLoading && prompts.length === 0) {
    return (
      <Grid gutter="md" h="calc(100vh - 100px)">
        <Grid.Col span={12}>
          <Card h="100%" withBorder>
            <Stack align="center" justify="center" h="100%" gap="md">
              <Loader size="lg" />
              <Text c="dimmed">Loading prompts...</Text>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    );
  }

  // Show error state
  if (error) {
    return (
      <Grid gutter="md" h="calc(100vh - 100px)">
        <Grid.Col span={12}>
          <Card h="100%" withBorder>
            <Stack align="center" justify="center" h="100%" gap="md">
              <IconAlertCircle size={48} color="red" />
              <Title order={3} c="red">Error Loading Prompts</Title>
              <Text c="dimmed">{error}</Text>
              <Button onClick={handleRefresh}>Retry</Button>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    );
  }

  // Show empty state if no prompts capability
  if (prompts.length === 0) {
    return (
      <Grid gutter="md" h="calc(100vh - 100px)">
        <Grid.Col span={12}>
          <Card h="100%" withBorder>
            <Stack align="center" justify="center" h="100%" gap="md">
              <Title order={3} c="dimmed">No Prompts Available</Title>
              <Text c="dimmed">This server does not expose any prompts.</Text>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    );
  }

  return (
    <Grid gutter="md" h="calc(100vh - 100px)">
      {/* Prompt Selection Panel (35%) */}
      <Grid.Col span={4}>
        <Card h="100%" withBorder>
          <Stack gap="md" p="md">
            <Group justify="space-between">
              <Title order={5}>Prompts ({prompts.length})</Title>
            </Group>
            <ListChangedIndicator
              hasChanges={listChanged}
              onRefresh={handleRefresh}
              label="List updated"
            />

            <Select
              label="Select Prompt"
              placeholder="Choose a prompt..."
              data={prompts.map((p) => ({
                value: p.name,
                label: p.name,
              }))}
              value={selectedPrompt?.name || null}
              onChange={handlePromptChange}
            />

            {selectedPrompt && (
              <>
                {selectedPrompt.description && (
                  <Text size="sm" c="dimmed">
                    {selectedPrompt.description}
                  </Text>
                )}

                <Box>
                  <Title order={5}>Arguments</Title>
                </Box>

                <Stack gap="sm">
                  {selectedPrompt.arguments && selectedPrompt.arguments.length > 0 ? (
                    selectedPrompt.arguments.map((arg) => (
                      <Box key={arg.name}>
                        <TextInput
                          label={arg.name}
                          placeholder={arg.description || `Enter ${arg.name}...`}
                          required={arg.required}
                          value={promptArgs[arg.name] || ''}
                          onChange={(e) => handleArgChange(arg.name, e.target.value)}
                        />
                        {arg.description && (
                          <Text size="xs" c="dimmed" mt={4}>
                            {arg.description}
                          </Text>
                        )}
                      </Box>
                    ))
                  ) : (
                    <Text size="sm" c="dimmed">
                      This prompt has no arguments
                    </Text>
                  )}
                </Stack>

                <Button
                  onClick={handleGetPrompt}
                  loading={isGettingPrompt}
                  disabled={isGettingPrompt}
                >
                  Get Prompt
                </Button>
              </>
            )}
          </Stack>
        </Card>
      </Grid.Col>

      {/* Result Panel (65%) */}
      <Grid.Col span={8}>
        <Card h="100%" withBorder>
          <Stack gap="md" p="md">
            <Title order={4}>Messages</Title>

            <ScrollArea h="calc(100vh - 250px)">
              {promptError ? (
                <Card withBorder p="sm" bg="red.9">
                  <Text size="sm" c="red.1">
                    Error: {promptError}
                  </Text>
                </Card>
              ) : isGettingPrompt ? (
                <Stack align="center" py="xl">
                  <Loader size="sm" />
                  <Text size="sm" c="dimmed">Getting prompt...</Text>
                </Stack>
              ) : promptResult && promptResult.length > 0 ? (
                <Stack gap="md">
                  {promptResult.map((message, index) => (
                    <Card key={index} withBorder p="sm">
                      <Text size="xs" fw={600} c="dimmed">
                        [{index}] role: {message.role}
                      </Text>
                      <Code block mt="xs">
                        {getMessageText(message)}
                      </Code>
                    </Card>
                  ))}
                </Stack>
              ) : (
                <Stack align="center" py="xl">
                  <Text c="dimmed">
                    Select a prompt and click "Get Prompt" to see messages
                  </Text>
                </Stack>
              )}
            </ScrollArea>

            {promptResult && promptResult.length > 0 && (
              <Button variant="outline" size="xs" onClick={handleCopy}>
                Copy
              </Button>
            )}
          </Stack>
        </Card>
      </Grid.Col>
    </Grid>
  );
}
