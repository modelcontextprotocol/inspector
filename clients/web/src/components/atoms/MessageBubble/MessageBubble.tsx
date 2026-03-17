import { Image, Paper, Stack, Text } from '@mantine/core';

export interface MessageBubbleProps {
  index: number;
  role: 'user' | 'assistant';
  content: string;
  imageContent?: { data: string; mimeType: string };
  audioContent?: { data: string; mimeType: string };
}

export function MessageBubble({
  index,
  role,
  content,
  imageContent,
  audioContent,
}: MessageBubbleProps) {
  return (
    <Paper p="md" radius="md" withBorder>
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          [{index}] role: {role}
        </Text>
        <Text size="sm">&quot;{content}&quot;</Text>
        {imageContent && (
          <Image
            src={`data:${imageContent.mimeType};base64,${imageContent.data}`}
            maw={300}
            radius="sm"
            mt="xs"
          />
        )}
        {audioContent && (
          <audio controls>
            <source
              src={`data:${audioContent.mimeType};base64,${audioContent.data}`}
              type={audioContent.mimeType}
            />
          </audio>
        )}
      </Stack>
    </Paper>
  );
}
