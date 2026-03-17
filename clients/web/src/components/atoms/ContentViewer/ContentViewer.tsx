import { Button, Code, Image, Stack } from '@mantine/core';

export interface ContentViewerProps {
  type: 'text' | 'json' | 'image' | 'audio';
  content: string;
  mimeType?: string;
  onCopy?: () => void;
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

export function ContentViewer({ type, content, mimeType, onCopy }: ContentViewerProps) {
  return (
    <Stack gap="xs">
      {type === 'json' && <Code block>{formatJson(content)}</Code>}
      {type === 'text' && <Code block>{content}</Code>}
      {type === 'image' && (
        <Image
          src={`data:${mimeType || 'image/png'};base64,${content}`}
          alt="Content preview"
          maw={400}
          radius="md"
        />
      )}
      {type === 'audio' && (
        <audio controls>
          <source src={`data:${mimeType || 'audio/wav'};base64,${content}`} />
        </audio>
      )}
      {onCopy && (
        <Button variant="light" size="xs" onClick={onCopy}>
          Copy
        </Button>
      )}
    </Stack>
  );
}
