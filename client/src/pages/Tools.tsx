import { useState, useEffect } from 'react';
import {
  Grid,
  Card,
  Text,
  TextInput,
  Textarea,
  Stack,
  Button,
  ScrollArea,
  Title,
  Code,
  Group,
  Progress,
  Loader,
} from '@mantine/core';
import { IconPlugConnectedX, IconAlertCircle } from '@tabler/icons-react';
import { ListChangedIndicator } from '../components/ListChangedIndicator';
import { AnnotationBadges } from '../components/AnnotationBadges';
import { PendingClientRequestsPanel } from '../components/PendingClientRequestsPanel';
import {
  useExecution,
  useActiveProfile,
  useMcp,
  generateRequestId,
} from '@/context';
import { useMcpTools, useSamplingHandler } from '@/hooks';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { SamplingResponse } from '@modelcontextprotocol/inspector-core';

export function Tools() {
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [toolArgs, setToolArgs] = useState('{}');
  const [toolResult, setToolResult] = useState<string | null>(null);
  const [executionStartTime, setExecutionStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // MCP connection and tools
  const { isConnected } = useMcp();
  // NOTE: Using useMcpTools instead of useTrackedMcpTools.
  // Tracked version (with history/logging) will be added when storage contexts are implemented.
  const {
    tools,
    isLoading: toolsLoading,
    error: toolsError,
    listChanged,
    refresh,
    clearListChanged,
    executeTool,
  } = useMcpTools();

  // Use ExecutionContext for execution state
  const { state, dispatch } = useExecution();
  const activeProfile = useActiveProfile();
  const isExecuting = state.isExecuting;

  // Sampling handler for client requests
  const {
    setupHandler: setupSamplingHandler,
    handleResponse: handleSamplingResponse,
    handleReject: handleSamplingReject,
    cleanup: cleanupSampling,
  } = useSamplingHandler();

  // Select first tool when tools load
  useEffect(() => {
    if (tools.length > 0 && !selectedTool) {
      setSelectedTool(tools[0]);
    }
  }, [tools, selectedTool]);

  // Update elapsed time every 100ms while executing
  useEffect(() => {
    if (isExecuting && executionStartTime) {
      const interval = setInterval(() => {
        setElapsedTime(Date.now() - executionStartTime);
      }, 100);
      return () => clearInterval(interval);
    } else if (!isExecuting) {
      setElapsedTime(0);
    }
  }, [isExecuting, executionStartTime]);

  const handleRefresh = async () => {
    await refresh();
    clearListChanged();
  };

  const handleExecute = async () => {
    if (!selectedTool) return;

    const requestId = generateRequestId();
    dispatch({ type: 'START_EXECUTION', requestId });
    setToolResult(null);
    setExecutionStartTime(Date.now());

    // Set up sampling handler for this execution
    setupSamplingHandler(requestId);

    // Show progress
    dispatch({
      type: 'UPDATE_PROGRESS',
      progress: { current: 0, total: 100, message: 'Sending request to server...' },
    });

    try {
      // Parse tool arguments
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolArgs);
      } catch {
        // If not valid JSON, try to use it as a simple message
        if (toolArgs.trim() && toolArgs.trim() !== '{}') {
          args = { message: toolArgs };
        }
      }

      dispatch({
        type: 'UPDATE_PROGRESS',
        progress: { current: 50, total: 100, message: 'Executing tool...' },
      });

      // Execute tool (tracking will be added when storage contexts are implemented)
      const result = await executeTool(selectedTool.name, args);

      dispatch({
        type: 'UPDATE_PROGRESS',
        progress: { current: 100, total: 100, message: 'Complete!' },
      });

      // Show result
      setToolResult(JSON.stringify(result, null, 2));
      dispatch({ type: 'END_EXECUTION' });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setToolResult(JSON.stringify({ error: errorMessage }, null, 2));
      dispatch({ type: 'END_EXECUTION' });
    } finally {
      // Clean up sampling handler
      cleanupSampling();
    }
  };

  const handleCancel = () => {
    dispatch({ type: 'CANCEL_EXECUTION' });
    cleanupSampling();
    setToolResult(null);
    setExecutionStartTime(null);
  };

  const handleProfileChange = (profileId: string) => {
    dispatch({ type: 'SET_ACTIVE_PROFILE', profileId });
  };

  const handleResolveSampling = (requestId: string, response: SamplingResponse) => {
    // Use the sampling handler to resolve the request (sends response to server)
    handleSamplingResponse(requestId, response);
    // Remove from UI
    dispatch({ type: 'REMOVE_CLIENT_REQUEST', id: requestId });
  };

  const handleResolveElicitation = (requestId: string, data: Record<string, unknown>) => {
    // TODO: Wire up elicitation handler when implemented
    dispatch({
      type: 'UPDATE_CLIENT_REQUEST',
      id: requestId,
      status: 'completed',
      response: data,
    });
    dispatch({ type: 'REMOVE_CLIENT_REQUEST', id: requestId });
  };

  const handleReject = (requestId: string) => {
    // Use the sampling handler to reject the request
    handleSamplingReject(requestId);
    // Remove from UI
    dispatch({ type: 'REMOVE_CLIENT_REQUEST', id: requestId });
  };

  const filteredTools = tools.filter((tool) =>
    tool.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  // Show disconnected state
  if (!isConnected) {
    return (
      <Grid gutter="md" h="calc(100vh - 120px)">
        <Grid.Col span={12}>
          <Card h="100%" withBorder>
            <Stack align="center" justify="center" h="100%" gap="md">
              <IconPlugConnectedX size={48} color="gray" />
              <Title order={3} c="dimmed">Not Connected</Title>
              <Text c="dimmed">Connect to an MCP server to view and execute tools.</Text>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    );
  }

  // Show loading state
  if (toolsLoading && tools.length === 0) {
    return (
      <Grid gutter="md" h="calc(100vh - 120px)">
        <Grid.Col span={12}>
          <Card h="100%" withBorder>
            <Stack align="center" justify="center" h="100%" gap="md">
              <Loader size="lg" />
              <Text c="dimmed">Loading tools...</Text>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    );
  }

  // Show error state
  if (toolsError) {
    return (
      <Grid gutter="md" h="calc(100vh - 120px)">
        <Grid.Col span={12}>
          <Card h="100%" withBorder>
            <Stack align="center" justify="center" h="100%" gap="md">
              <IconAlertCircle size={48} color="red" />
              <Title order={3} c="red">Error Loading Tools</Title>
              <Text c="dimmed">{toolsError}</Text>
              <Button onClick={handleRefresh}>Retry</Button>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    );
  }

  return (
    <Grid gutter="md" h="calc(100vh - 120px)">
      {/* Tool List Panel (3/12) */}
      <Grid.Col span={3}>
        <Card h="100%" withBorder style={{ display: 'flex', flexDirection: 'column' }}>
          <Stack gap="xs" p="md">
            <Group justify="space-between">
              <Title order={5}>Tools ({tools.length})</Title>
            </Group>
            <ListChangedIndicator
              hasChanges={listChanged}
              onRefresh={handleRefresh}
              label="List updated"
            />
          </Stack>
          <Stack gap="sm" p="md" pt={0} flex={1} style={{ overflow: 'hidden' }}>
            <TextInput
              placeholder="Search tools..."
              size="sm"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
            <ScrollArea flex={1}>
              <Stack gap="xs">
                {filteredTools.map((tool) => (
                  <Stack key={tool.name} gap={4}>
                    <Button
                      variant={selectedTool?.name === tool.name ? 'filled' : 'subtle'}
                      justify="flex-start"
                      fullWidth
                      onClick={() => setSelectedTool(tool)}
                    >
                      {tool.name}
                    </Button>
                    {/* Annotation badges below tool name */}
                    <AnnotationBadges
                      annotations={tool.annotations}
                      className="pl-sm pb-xs"
                    />
                  </Stack>
                ))}
              </Stack>
            </ScrollArea>
          </Stack>
        </Card>
      </Grid.Col>

      {/* Parameters Panel (5/12) */}
      <Grid.Col span={5}>
        <Card h="100%" withBorder>
          <Stack gap="md" p="md">
            {selectedTool ? (
              <>
                <Stack gap={4}>
                  <Title order={4}>Tool: {selectedTool.name}</Title>
                  <Text size="sm" c="dimmed">{selectedTool.description}</Text>
                </Stack>

                {/* Display annotations if available */}
                {selectedTool.annotations && Object.keys(selectedTool.annotations).length > 0 && (
                  <Stack gap="xs">
                    <Text size="sm" fw={500}>Annotations:</Text>
                    <AnnotationBadges annotations={selectedTool.annotations} />
                  </Stack>
                )}

                {/* Input schema info */}
                {selectedTool.inputSchema && (
                  <Stack gap="xs">
                    <Text size="sm" fw={500}>Input Schema:</Text>
                    <Code block style={{ maxHeight: '150px', overflow: 'auto' }}>
                      {JSON.stringify(selectedTool.inputSchema, null, 2)}
                    </Code>
                  </Stack>
                )}

                {/* Tool arguments input */}
                <Textarea
                  label="Arguments (JSON)"
                  placeholder='{"key": "value"}'
                  value={toolArgs}
                  onChange={(e) => setToolArgs(e.target.value)}
                  disabled={isExecuting}
                  minRows={3}
                  autosize
                  maxRows={6}
                  styles={{ input: { fontFamily: 'monospace' } }}
                />
              </>
            ) : (
              <Stack align="center" justify="center" h="200px">
                <Text c="dimmed">Select a tool to view details</Text>
              </Stack>
            )}

            {/* Execute / Cancel buttons */}
            {selectedTool && (
              <Group gap="sm">
                <Button flex={1} onClick={handleExecute} disabled={isExecuting || !selectedTool}>
                  {isExecuting ? 'Executing...' : 'Execute Tool'}
                </Button>
                {isExecuting && (
                  <Button variant="outline" color="red" onClick={handleCancel}>
                    Cancel
                  </Button>
                )}
              </Group>
            )}

            {/* Progress indicator during execution */}
            {isExecuting && state.progress && (
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    {state.progress.message || 'Executing...'}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {(elapsedTime / 1000).toFixed(1)}s
                  </Text>
                </Group>
                <Progress
                  value={(state.progress.current / state.progress.total) * 100}
                  size="md"
                  animated
                />
                <Text size="xs" c="dimmed" ta="center">
                  {state.progress.current}% complete
                </Text>
              </Stack>
            )}
          </Stack>
        </Card>
      </Grid.Col>

      {/* Results Panel (4/12) */}
      <Grid.Col span={4}>
        <Card h="100%" withBorder>
          {state.pendingClientRequests.length > 0 ? (
            <PendingClientRequestsPanel
              requests={state.pendingClientRequests}
              activeProfile={activeProfile}
              profiles={state.profiles}
              onProfileChange={handleProfileChange}
              onResolveSampling={handleResolveSampling}
              onResolveElicitation={handleResolveElicitation}
              onReject={handleReject}
              onCancelTool={handleCancel}
            />
          ) : (
            <Stack gap="md" p="md">
              <Title order={4}>Results</Title>
              <ScrollArea flex={1} mah="60vh">
                <Code block>
                  {toolResult || JSON.stringify(
                    {
                      content: [
                        {
                          type: 'text',
                          text: 'Execute a tool to see results here.',
                        },
                      ],
                    },
                    null,
                    2
                  )}
                </Code>
              </ScrollArea>
              <Group gap="sm">
                <Button variant="outline" size="xs">
                  Copy
                </Button>
                <Button variant="outline" size="xs" onClick={() => setToolResult(null)}>
                  Clear
                </Button>
              </Group>
            </Stack>
          )}
        </Card>
      </Grid.Col>
    </Grid>
  );
}
