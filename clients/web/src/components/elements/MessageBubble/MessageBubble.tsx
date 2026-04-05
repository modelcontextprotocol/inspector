import { Group, Image, Paper, Stack, Text } from "@mantine/core";
import { CopyButton } from "../CopyButton/CopyButton";

export interface MessageBubbleProps {
  index: number;
  role: "user" | "assistant";
  content: string;
  imageContent?: { data: string; mimeType: string };
  audioContent?: { data: string; mimeType: string };
}

function buildDataUri(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

function formatRoleLabel(index: number, role: string): string {
  return `[${index}] role: ${role}`;
}

function formatQuotedContent(content: string): string {
  return `"${content}"`;
}

const BubbleContainer = Paper.withProps({
  p: "md",
  radius: "md",
  withBorder: true,
});

const RoleLabel = Text.withProps({
  size: "xs",
  c: "dimmed",
});

const PreviewImage = Image.withProps({
  maw: 300,
  radius: "sm",
  mt: "xs",
});

export function MessageBubble({
  index,
  role,
  content,
  imageContent,
  audioContent,
}: MessageBubbleProps) {
  return (
    <BubbleContainer>
      <Stack gap="xs">
        <Group justify="space-between">
          <RoleLabel>{formatRoleLabel(index, role)}</RoleLabel>
          <CopyButton value={content} />
        </Group>
        <Text size="sm">{formatQuotedContent(content)}</Text>
        {imageContent && (
          <PreviewImage
            src={buildDataUri(imageContent.mimeType, imageContent.data)}
          />
        )}
        {audioContent && (
          <audio controls>
            <source
              src={buildDataUri(audioContent.mimeType, audioContent.data)}
              type={audioContent.mimeType}
            />
          </audio>
        )}
      </Stack>
    </BubbleContainer>
  );
}
