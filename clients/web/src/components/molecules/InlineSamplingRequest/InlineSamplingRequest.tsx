import { Badge, Button, Group, Paper, Stack, Text, Textarea } from '@mantine/core'

export interface InlineSamplingRequestProps {
  queuePosition: string
  modelHints?: string[]
  messagePreview: string
  responseText: string
  onAutoRespond: () => void
  onEditAndSend: () => void
  onReject: () => void
  onViewDetails: () => void
}

export function InlineSamplingRequest({
  queuePosition,
  modelHints,
  messagePreview,
  responseText,
  onAutoRespond,
  onEditAndSend,
  onReject,
  onViewDetails,
}: InlineSamplingRequestProps) {
  return (
    <Paper p="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Badge color="blue">sampling/createMessage</Badge>
          <Text size="xs" c="dimmed">
            {queuePosition}
          </Text>
        </Group>

        {modelHints && (
          <Text size="sm">Model hints: {modelHints.join(', ')}</Text>
        )}

        <Text size="sm" c="dimmed" lineClamp={2}>
          {messagePreview}
        </Text>

        <Button variant="subtle" size="xs" onClick={onViewDetails}>
          View Details
        </Button>

        <Textarea
          size="sm"
          value={responseText}
          placeholder="Response..."
          autosize
          minRows={2}
          readOnly
        />

        <Group justify="flex-end" gap="xs">
          <Button size="xs" variant="light" onClick={onAutoRespond}>
            Auto-respond
          </Button>
          <Button size="xs" variant="light" onClick={onEditAndSend}>
            Edit &amp; Send
          </Button>
          <Button size="xs" variant="light" color="red" onClick={onReject}>
            Reject
          </Button>
        </Group>
      </Stack>
    </Paper>
  )
}
