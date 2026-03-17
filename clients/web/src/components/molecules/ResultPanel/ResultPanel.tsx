import { Button, Group, Stack, Text, Title } from '@mantine/core'
import { ContentViewer } from '../../atoms/ContentViewer/ContentViewer'

export interface ResultContentItem {
  type: string
  text?: string
  data?: string
  mimeType?: string
}

export interface ResultPanelProps {
  content: ResultContentItem[]
  onCopy: () => void
  onClear: () => void
}

export function ResultPanel({ content, onCopy, onClear }: ResultPanelProps) {
  return (
    <Stack>
      <Title order={4}>Results</Title>
      {content.length === 0 ? (
        <Text c="dimmed">No results yet</Text>
      ) : (
        <>
          {content.map((item, index) => {
            if (item.text !== undefined) {
              return (
                <ContentViewer
                  key={index}
                  type={item.type === 'text' ? 'text' : 'json'}
                  content={item.text}
                />
              )
            }
            if (item.data !== undefined) {
              return (
                <ContentViewer
                  key={index}
                  type={item.mimeType?.startsWith('image') ? 'image' : 'audio'}
                  content={item.data}
                  mimeType={item.mimeType}
                />
              )
            }
            return null
          })}
        </>
      )}
      <Group>
        <Button variant="light" size="sm" onClick={onCopy}>
          Copy
        </Button>
        <Button variant="light" size="sm" onClick={onClear}>
          Clear
        </Button>
      </Group>
    </Stack>
  )
}
