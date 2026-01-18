import { useState, useEffect } from 'react';
import {
  Card,
  Stack,
  Group,
  Text,
  Badge,
  Textarea,
  TextInput,
  Select,
  Button,
  Anchor,
} from '@mantine/core';
import {
  IconBrain,
  IconX,
  IconEdit,
  IconPlayerPlay,
} from '@tabler/icons-react';
import type { SamplingRequest, TestingProfile } from '@modelcontextprotocol/inspector-core';
import { getResponseForModelHint } from '@modelcontextprotocol/inspector-core';
import { TestingProfileSelector } from './TestingProfileSelector';

export interface SamplingResponse {
  content: { type: 'text'; text: string };
  model: string;
  stopReason: 'endTurn' | 'stopSequence' | 'maxTokens' | 'toolUse';
}

interface SamplingRequestCardProps {
  request: SamplingRequest;
  requestId: string;
  position: { current: number; total: number };
  activeProfile: TestingProfile | undefined;
  profiles: TestingProfile[];
  onProfileChange: (profileId: string) => void;
  onAutoRespond: (response: SamplingResponse) => void;
  onEditAndSend: (response: SamplingResponse) => void;
  onReject: () => void;
  onViewDetails: () => void;
}

export function SamplingRequestCard({
  request,
  position,
  activeProfile,
  profiles,
  onProfileChange,
  onAutoRespond,
  onEditAndSend,
  onReject,
  onViewDetails,
}: SamplingRequestCardProps) {
  // Get default response from profile
  const getDefaultResponse = () => {
    if (!activeProfile) return '';
    return getResponseForModelHint(
      activeProfile,
      request.modelPreferences?.hints
    );
  };

  const getDefaultModel = () => {
    return activeProfile?.defaultModel || 'mock-model-1.0';
  };

  const getDefaultStopReason = () => {
    return activeProfile?.defaultStopReason || 'endTurn';
  };

  const [response, setResponse] = useState(getDefaultResponse);
  const [modelUsed, setModelUsed] = useState(getDefaultModel);
  const [stopReason, setStopReason] = useState<
    'endTurn' | 'stopSequence' | 'maxTokens' | 'toolUse'
  >(getDefaultStopReason);

  // Update response when profile changes
  useEffect(() => {
    setResponse(getDefaultResponse());
    setModelUsed(getDefaultModel());
    setStopReason(getDefaultStopReason());
  }, [activeProfile?.id]);

  // Get first text message for preview
  const getMessagePreview = () => {
    const textMessage = request.messages.find(
      (m) => m.content.type === 'text'
    );
    if (textMessage && textMessage.content.type === 'text') {
      const text = textMessage.content.text;
      return text.length > 80 ? text.substring(0, 80) + '...' : text;
    }
    return '(no text content)';
  };

  const buildResponse = (): SamplingResponse => ({
    content: { type: 'text', text: response },
    model: modelUsed,
    stopReason,
  });

  const handleAutoRespond = () => {
    onAutoRespond(buildResponse());
  };

  const handleEditAndSend = () => {
    onEditAndSend(buildResponse());
  };

  return (
    <Card withBorder p="sm">
      <Stack gap="xs">
        {/* Header */}
        <Group justify="space-between">
          <Group gap="xs">
            <IconBrain size={16} />
            <Text size="sm" fw={500}>
              sampling/createMessage
            </Text>
          </Group>
          <Badge variant="outline" size="sm">
            {position.current} of {position.total}
          </Badge>
        </Group>

        {/* Model hints */}
        {request.modelPreferences?.hints &&
          request.modelPreferences.hints.length > 0 && (
            <Group gap="xs">
              <Text size="xs" c="dimmed">
                Model hints:
              </Text>
              {request.modelPreferences.hints.map((hint) => (
                <Badge key={hint} variant="light" size="xs">
                  {hint}
                </Badge>
              ))}
            </Group>
          )}

        {/* Message preview */}
        <Group gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            Message:
          </Text>
          <Text size="xs" lineClamp={1} style={{ flex: 1 }}>
            {getMessagePreview()}
          </Text>
          <Anchor size="xs" onClick={onViewDetails} style={{ flexShrink: 0 }}>
            View Details
          </Anchor>
        </Group>

        {/* Testing Profile */}
        <TestingProfileSelector
          profiles={profiles}
          activeProfileId={activeProfile?.id || 'manual'}
          onChange={onProfileChange}
          size="xs"
          label="Testing Profile"
        />

        {/* Response */}
        <Textarea
          label="Response"
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          minRows={2}
          maxRows={4}
          size="xs"
          styles={{ input: { fontFamily: 'monospace', fontSize: '0.75rem' } }}
          placeholder="Enter mock LLM response..."
        />

        {/* Model and Stop Reason */}
        <Group grow gap="xs">
          <TextInput
            label="Model"
            value={modelUsed}
            onChange={(e) => setModelUsed(e.target.value)}
            size="xs"
            placeholder="e.g., claude-3-sonnet"
          />
          <Select
            label="Stop Reason"
            value={stopReason}
            onChange={(v) =>
              setStopReason(
                (v as 'endTurn' | 'stopSequence' | 'maxTokens' | 'toolUse') ||
                  'endTurn'
              )
            }
            size="xs"
            data={[
              { value: 'endTurn', label: 'endTurn' },
              { value: 'stopSequence', label: 'stopSequence' },
              { value: 'maxTokens', label: 'maxTokens' },
              { value: 'toolUse', label: 'toolUse' },
            ]}
            allowDeselect={false}
          />
        </Group>

        {/* Action buttons */}
        <Group justify="flex-end" gap="xs" mt="xs">
          <Button
            size="xs"
            variant="outline"
            color="red"
            leftSection={<IconX size={14} />}
            onClick={onReject}
          >
            Reject
          </Button>
          <Button
            size="xs"
            variant="outline"
            leftSection={<IconEdit size={14} />}
            onClick={handleEditAndSend}
          >
            Edit & Send
          </Button>
          <Button
            size="xs"
            leftSection={<IconPlayerPlay size={14} />}
            onClick={handleAutoRespond}
            disabled={!activeProfile?.autoRespond}
          >
            Auto-respond
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
