import {
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core'
import { MessageBubble } from '../../atoms/MessageBubble/MessageBubble'

export interface SamplingMessage {
  role: string
  content: string
  imageContent?: { data: string; mimeType: string }
}

export interface SamplingTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface SamplingRequestPanelProps {
  messages: SamplingMessage[]
  modelHints?: string[]
  costPriority?: number
  speedPriority?: number
  intelligencePriority?: number
  maxTokens?: number
  stopSequences?: string[]
  temperature?: number
  includeContext?: string
  tools?: SamplingTool[]
  toolChoice?: string
  responseText: string
  modelUsed: string
  stopReason: string
  onResponseChange: (text: string) => void
  onModelChange: (model: string) => void
  onStopReasonChange: (reason: string) => void
  onAutoRespond: () => void
  onSend: () => void
  onReject: () => void
}

function formatPriority(value: number): string {
  if (value < 0.4) return `low (${value})`
  if (value <= 0.7) return `medium (${value})`
  return `high (${value})`
}

export function SamplingRequestPanel({
  messages,
  modelHints,
  costPriority,
  speedPriority,
  intelligencePriority,
  maxTokens,
  stopSequences,
  temperature,
  includeContext,
  tools,
  toolChoice,
  responseText,
  modelUsed,
  stopReason,
  onResponseChange,
  onModelChange,
  onStopReasonChange,
  onAutoRespond,
  onSend,
  onReject,
}: SamplingRequestPanelProps) {
  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        The server is requesting an LLM completion.
      </Text>

      <Title order={5}>Messages:</Title>
      {messages.map((message, index) => (
        <MessageBubble
          key={index}
          index={index}
          role={message.role as 'user' | 'assistant'}
          content={message.content}
          imageContent={message.imageContent}
        />
      ))}

      {modelHints && modelHints.length > 0 && (
        <Paper p="sm" withBorder>
          <Stack gap="xs">
            <Title order={5}>Model Preferences:</Title>
            <Group gap="xs">
              <Text size="sm">Hints:</Text>
              {modelHints.map((hint) => (
                <Badge key={hint}>{hint}</Badge>
              ))}
            </Group>
            {costPriority !== undefined && (
              <Text size="sm">Cost Priority: {formatPriority(costPriority)}</Text>
            )}
            {speedPriority !== undefined && (
              <Text size="sm">Speed Priority: {formatPriority(speedPriority)}</Text>
            )}
            {intelligencePriority !== undefined && (
              <Text size="sm">Intelligence Priority: {formatPriority(intelligencePriority)}</Text>
            )}
          </Stack>
        </Paper>
      )}

      <Title order={5}>Parameters:</Title>
      <Text size="sm">Max Tokens: {maxTokens ?? 'not specified'}</Text>
      <Text size="sm">Stop Sequences: {stopSequences ? JSON.stringify(stopSequences) : 'not specified'}</Text>
      <Text size="sm">Temperature: {temperature !== undefined ? temperature : 'not specified'}</Text>

      {includeContext && (
        <Checkbox label={`Include Context: ${includeContext}`} checked readOnly />
      )}

      {tools && tools.length > 0 && (
        <>
          <Title order={5}>Available Tools:</Title>
          {tools.map((tool) => (
            <Paper key={tool.name} p="xs" withBorder>
              <Text size="sm" fw={600}>
                {tool.name}
              </Text>
              {tool.description && <Text size="sm">{tool.description}</Text>}
            </Paper>
          ))}
        </>
      )}

      {toolChoice && <Text size="sm">Tool Choice: {toolChoice}</Text>}

      <Divider />

      <Title order={5}>Response:</Title>
      <Textarea
        value={responseText}
        onChange={(event) => onResponseChange(event.currentTarget.value)}
        autosize
        minRows={3}
      />
      <Group>
        <TextInput
          label="Model Used"
          value={modelUsed}
          onChange={(event) => onModelChange(event.currentTarget.value)}
        />
        <Select
          label="Stop Reason"
          data={['end_turn', 'max_tokens', 'stop_sequence', 'toolUse']}
          value={stopReason}
          onChange={(value) => onStopReasonChange(value ?? '')}
        />
      </Group>
      <Group justify="flex-end">
        <Button variant="light" onClick={onAutoRespond}>
          Auto-respond
        </Button>
        <Button variant="light" color="red" onClick={onReject}>
          Reject
        </Button>
        <Button onClick={onSend}>Send Response</Button>
      </Group>
    </Stack>
  )
}
