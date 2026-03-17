import { Button, Group, Stack, Text, Title } from '@mantine/core'
import { ContentViewer } from '../../atoms/ContentViewer/ContentViewer'

export interface ResourcePreviewPanelProps {
  uri: string
  mimeType: string
  annotations?: { audience?: string; priority?: number }
  content: string
  lastUpdated?: string
  isSubscribed: boolean
  onCopy: () => void
  onSubscribe: () => void
  onUnsubscribe: () => void
}

function resolveContentType(mimeType: string): 'json' | 'image' | 'text' {
  if (mimeType === 'application/json') return 'json'
  if (mimeType.startsWith('image/')) return 'image'
  return 'text'
}

export function ResourcePreviewPanel({
  uri,
  mimeType,
  annotations,
  content,
  lastUpdated,
  isSubscribed,
  onCopy,
  onSubscribe,
  onUnsubscribe,
}: ResourcePreviewPanelProps) {
  return (
    <Stack gap="md">
      <Title order={4}>Content Preview</Title>
      <Text size="sm">
        URI: <Text span c="blue">{uri}</Text>
      </Text>
      <Text size="sm" c="dimmed">
        MIME: {mimeType}
      </Text>
      {annotations && (
        <Stack gap="xs">
          <Text size="sm">Annotations:</Text>
          {annotations.audience && (
            <Text size="sm" c="dimmed">Audience: {annotations.audience}</Text>
          )}
          {annotations.priority !== undefined && (
            <Text size="sm" c="dimmed">Priority: {annotations.priority}</Text>
          )}
        </Stack>
      )}
      <ContentViewer
        type={resolveContentType(mimeType)}
        content={content}
        mimeType={mimeType}
      />
      <Group>
        <Button variant="light" size="sm" onClick={onCopy}>
          Copy
        </Button>
        <Button
          variant="light"
          size="sm"
          onClick={isSubscribed ? onUnsubscribe : onSubscribe}
        >
          {isSubscribed ? 'Unsubscribe' : 'Subscribe'}
        </Button>
      </Group>
      {lastUpdated && (
        <Text size="xs" c="dimmed" ta="right">
          Last updated: {lastUpdated}
        </Text>
      )}
    </Stack>
  )
}
