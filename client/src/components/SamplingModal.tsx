import { useState } from 'react';
import {
  IconCopy,
  IconCheck,
  IconPhoto,
  IconAlertTriangle,
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
import { mockSamplingRequest, type SamplingMessage, type SamplingRequest } from '@/mocks';

interface SamplingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function SamplingModal({ open, onOpenChange }: SamplingModalProps) {
  const [response, setResponse] = useState(
    'Based on the data chart, I can see several key trends:\n\n1. Revenue has increased 25% quarter-over-quarter\n2. User engagement peaks on Tuesdays\n3. Mobile usage continues to grow at 15% monthly'
  );
  const [modelUsed, setModelUsed] = useState('claude-3-sonnet-20241022');
  const [stopReason, setStopReason] = useState('endTurn');
  const [copied, setCopied] = useState(false);

  const request: SamplingRequest = mockSamplingRequest;

  const handleCopyResponse = async () => {
    await navigator.clipboard.writeText(response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReject = () => {
    console.log('Sampling request rejected');
    onOpenChange(false);
  };

  const handleSendResponse = () => {
    console.log('Sending sampling response:', {
      content: { type: 'text', text: response },
      model: modelUsed,
      stopReason,
    });
    onOpenChange(false);
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
            onChange={(v) => setStopReason(v || 'endTurn')}
            data={[
              { value: 'endTurn', label: 'endTurn' },
              { value: 'stopSequence', label: 'stopSequence' },
              { value: 'maxTokens', label: 'maxTokens' },
              { value: 'toolUse', label: 'toolUse' },
            ]}
          />
        </Group>

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
