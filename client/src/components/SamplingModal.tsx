import { useState } from 'react';
import {
  IconCopy,
  IconCheck,
  IconPhoto,
  IconAlertTriangle,
  IconPlus,
  IconX,
} from '@tabler/icons-react';
import {
  Modal,
  Button,
  Badge,
  Card,
  Textarea,
  TextInput,
  Select,
  Checkbox,
  Text,
  Stack,
  Group,
  Progress,
  ActionIcon,
  Divider,
  ScrollArea,
} from '@mantine/core';
import { mockSamplingRequest } from '@/mocks';
import type {
  SamplingMessage,
  SamplingRequest,
  SamplingResponse,
  ToolCall,
  StopReason,
} from '@modelcontextprotocol/inspector-core';

// NOTE: Testing Profile integration will be added in PR #3.
// This modal currently works standalone without ExecutionContext.

interface SamplingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request?: SamplingRequest;
  onResponse?: (response: SamplingResponse) => void;
}

function PriorityBar({ value, label }: { value: number; label: string }) {
  const percentage = Math.round(value * 100);
  let priorityLabel = 'low';
  if (value > 0.6) priorityLabel = 'high';
  else if (value > 0.3) priorityLabel = 'medium';

  return (
    <Group gap="sm">
      <Text size="sm" c="dimmed" w={110}>
        {label}:
      </Text>
      <Progress value={percentage} style={{ flex: 1 }} size="sm" />
      <Text size="xs" w={80}>
        {priorityLabel} ({value})
      </Text>
    </Group>
  );
}

function MessageDisplay({ message }: { message: SamplingMessage }) {
  return (
    <Stack gap="xs" pb="sm" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
      <Badge variant="outline" size="sm">
        {message.role}
      </Badge>
      {message.content.type === 'text' ? (
        <Text size="sm">{message.content.text}</Text>
      ) : (
        <Group gap="xs">
          <IconPhoto size={16} />
          <Text size="sm" c="dimmed">
            [Image: {message.content.mimeType} - Click to preview]
          </Text>
        </Group>
      )}
    </Stack>
  );
}

export function SamplingModal({ open, onOpenChange, request: propRequest, onResponse }: SamplingModalProps) {
  const request: SamplingRequest = propRequest ?? mockSamplingRequest;

  const [response, setResponse] = useState(
    'Based on the data chart, I can see several key trends:\n\n1. Revenue has increased 25% quarter-over-quarter\n2. User engagement peaks on Tuesdays\n3. Mobile usage continues to grow at 15% monthly'
  );
  const [modelUsed, setModelUsed] = useState('claude-3-sonnet-20241022');
  const [stopReason, setStopReason] = useState<StopReason>('endTurn');
  const [copied, setCopied] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [toolChoice, setToolChoice] = useState<string>(
    request.toolChoice?.type === 'tool'
      ? `tool:${request.toolChoice.name}`
      : request.toolChoice?.type || 'auto'
  );

  const handleCopyResponse = async () => {
    await navigator.clipboard.writeText(response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReject = () => {
    onOpenChange(false);
  };

  const handleSendResponse = () => {
    const samplingResponse: SamplingResponse = {
      content: { type: 'text', text: response },
      model: modelUsed,
      stopReason,
      toolCalls: stopReason === 'toolUse' && toolCalls.length > 0 ? toolCalls : undefined,
    };
    onResponse?.(samplingResponse);
    onOpenChange(false);
  };

  const handleAddToolCall = () => {
    const newCall: ToolCall = {
      id: `call-${Date.now()}`,
      name: request.tools?.[0]?.name || '',
      arguments: {},
    };
    setToolCalls([...toolCalls, newCall]);
  };

  const handleRemoveToolCall = (index: number) => {
    setToolCalls(toolCalls.filter((_, i) => i !== index));
  };

  const handleUpdateToolCall = (index: number, updates: Partial<ToolCall>) => {
    const updated = [...toolCalls];
    updated[index] = { ...updated[index], ...updates };
    setToolCalls(updated);
  };

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title="Sampling Request"
      size="lg"
    >
      <Stack gap="md">
        {/* Description */}
        <Text size="sm" c="dimmed">
          The server is requesting an LLM completion.
        </Text>

        {/* Messages */}
        <div>
          <Text fw={500} mb="xs">
            Messages:
          </Text>
          <Card withBorder>
            <ScrollArea h={150}>
              <Stack gap="sm" p="sm">
                {request.messages.map((msg, idx) => (
                  <MessageDisplay key={idx} message={msg} />
                ))}
              </Stack>
            </ScrollArea>
          </Card>
        </div>

        {/* Model Preferences */}
        {request.modelPreferences && (
          <div>
            <Text fw={500} mb="xs">
              Model Preferences:
            </Text>
            <Card withBorder p="sm">
              <Stack gap="xs">
                {request.modelPreferences.hints &&
                  request.modelPreferences.hints.length > 0 && (
                    <Group gap="xs">
                      <Text size="sm" c="dimmed">
                        Hints:
                      </Text>
                      {request.modelPreferences.hints.map((hint) => (
                        <Badge key={hint} variant="light" size="sm">
                          {hint}
                        </Badge>
                      ))}
                    </Group>
                  )}
                {request.modelPreferences.costPriority !== undefined && (
                  <PriorityBar
                    value={request.modelPreferences.costPriority}
                    label="Cost Priority"
                  />
                )}
                {request.modelPreferences.speedPriority !== undefined && (
                  <PriorityBar
                    value={request.modelPreferences.speedPriority}
                    label="Speed Priority"
                  />
                )}
                {request.modelPreferences.intelligencePriority !== undefined && (
                  <PriorityBar
                    value={request.modelPreferences.intelligencePriority}
                    label="Intelligence"
                  />
                )}
              </Stack>
            </Card>
          </div>
        )}

        {/* Parameters */}
        <div>
          <Text fw={500} mb="xs">
            Parameters:
          </Text>
          <Group gap="xl">
            <Group gap="xs">
              <Text size="sm" c="dimmed">
                Max Tokens:
              </Text>
              <Text size="sm">{request.maxTokens}</Text>
            </Group>
            <Group gap="xs">
              <Text size="sm" c="dimmed">
                Temperature:
              </Text>
              <Text size="sm">{request.temperature ?? '(not specified)'}</Text>
            </Group>
          </Group>
          <Group gap="xs" mt="xs">
            <Text size="sm" c="dimmed">
              Stop Sequences:
            </Text>
            <Text size="sm">
              {request.stopSequences && request.stopSequences.length > 0
                ? `[${request.stopSequences.map((s) => `"${s}"`).join(', ')}]`
                : '(none)'}
            </Text>
          </Group>
        </div>

        {/* Tools (if present) */}
        {request.tools && request.tools.length > 0 && (
          <div>
            <Text fw={500} mb="xs">
              Available Tools ({request.tools.length}):
            </Text>
            <Card withBorder p="sm">
              <Stack gap="xs">
                {request.tools.map((tool, idx) => (
                  <Group key={idx} gap="xs" wrap="nowrap">
                    <Badge variant="outline" size="sm" style={{ flexShrink: 0 }}>
                      {tool.name}
                    </Badge>
                    {tool.description && (
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {tool.description}
                      </Text>
                    )}
                  </Group>
                ))}
              </Stack>
            </Card>
            <Group gap="xs" mt="xs" align="center">
              <Text size="sm" c="dimmed">Tool Choice:</Text>
              <Select
                size="xs"
                value={toolChoice}
                onChange={(v) => setToolChoice(v || 'auto')}
                data={[
                  { value: 'auto', label: 'auto (model decides)' },
                  { value: 'none', label: 'none (no tools)' },
                  { value: 'required', label: 'required (must use tool)' },
                  ...(request.tools?.map((t) => ({
                    value: `tool:${t.name}`,
                    label: `specific: ${t.name}`,
                  })) || []),
                ]}
                style={{ width: 200 }}
              />
            </Group>
          </div>
        )}

        {/* Include Context */}
        <Group gap="xs">
          <Checkbox
            checked={request.includeContext === 'thisServer'}
            disabled
            label={`Include Context: ${request.includeContext ?? 'none'}`}
          />
        </Group>

        <Divider />

        {/* Response Section */}
        <div>
          <Group justify="space-between" mb="xs">
            <Text fw={500}>
              Response (enter mock response or connect to LLM):
            </Text>
            <ActionIcon variant="subtle" onClick={handleCopyResponse}>
              {copied ? (
                <IconCheck size={16} color="green" />
              ) : (
                <IconCopy size={16} />
              )}
            </ActionIcon>
          </Group>
          <Textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            minRows={4}
            styles={{ input: { fontFamily: 'monospace', fontSize: '0.875rem' } }}
            placeholder="Enter the mock LLM response..."
          />
        </div>

        {/* Model and Stop Reason */}
        <Group grow>
          <TextInput
            label="Model Used:"
            value={modelUsed}
            onChange={(e) => setModelUsed(e.target.value)}
            placeholder="e.g., claude-3-sonnet"
          />
          <Select
            label="Stop Reason:"
            value={stopReason}
            onChange={(v) => setStopReason((v as StopReason) || 'endTurn')}
            data={[
              { value: 'endTurn', label: 'endTurn' },
              { value: 'stopSequence', label: 'stopSequence' },
              { value: 'maxTokens', label: 'maxTokens' },
              { value: 'toolUse', label: 'toolUse' },
            ]}
          />
        </Group>

        {/* Tool Calls (when stopReason is toolUse and tools are available) */}
        {stopReason === 'toolUse' && request.tools && request.tools.length > 0 && (
          <div>
            <Group justify="space-between" mb="xs">
              <Text fw={500}>Tool Calls Requested:</Text>
              <Button
                size="xs"
                variant="subtle"
                leftSection={<IconPlus size={14} />}
                onClick={handleAddToolCall}
              >
                Add Tool Call
              </Button>
            </Group>
            <Card withBorder p="sm">
              <Stack gap="sm">
                {toolCalls.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No tool calls. Add tool calls or change stop reason.
                  </Text>
                ) : (
                  toolCalls.map((call, idx) => (
                    <Group key={call.id} gap="xs" wrap="nowrap">
                      <Select
                        size="xs"
                        placeholder="Select tool"
                        value={call.name}
                        onChange={(v) => handleUpdateToolCall(idx, { name: v || '' })}
                        data={request.tools?.map(t => ({ value: t.name, label: t.name })) || []}
                        style={{ width: 150 }}
                      />
                      <TextInput
                        size="xs"
                        placeholder='{"arg": "value"}'
                        value={JSON.stringify(call.arguments)}
                        onChange={(e) => {
                          try {
                            const args = JSON.parse(e.target.value);
                            handleUpdateToolCall(idx, { arguments: args });
                          } catch {
                            // Ignore parse errors while typing
                          }
                        }}
                        style={{ flex: 1 }}
                      />
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="red"
                        onClick={() => handleRemoveToolCall(idx)}
                      >
                        <IconX size={14} />
                      </ActionIcon>
                    </Group>
                  ))
                )}
              </Stack>
            </Card>
          </div>
        )}

        {/* Actions */}
        <Group justify="flex-end" mt="md">
          <Button variant="outline" onClick={handleReject} leftSection={<IconAlertTriangle size={16} />}>
            Reject Request
          </Button>
          <Button onClick={handleSendResponse}>Send Response</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
