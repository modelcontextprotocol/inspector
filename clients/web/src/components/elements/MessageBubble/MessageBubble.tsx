import { Group, Image, Paper, Stack, Text } from "@mantine/core";
import type {
  PromptMessage,
  SamplingMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { CopyButton } from "../CopyButton/CopyButton";

export interface MessageBubbleProps {
  index: number;
  message: SamplingMessage | PromptMessage;
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

interface ContentBlockRendered {
  text: string;
  imageUri?: string;
  audioUri?: string;
  audioMime?: string;
}

function extractContent(
  message: SamplingMessage | PromptMessage,
): ContentBlockRendered {
  const content = message.content;
  const blocks = Array.isArray(content) ? content : [content];
  let text = "";
  let imageUri: string | undefined;
  let audioUri: string | undefined;
  let audioMime: string | undefined;

  for (const block of blocks) {
    switch (block.type) {
      case "text":
        text += block.text;
        break;
      case "image":
        imageUri = buildDataUri(block.mimeType, block.data);
        break;
      case "audio":
        audioUri = buildDataUri(block.mimeType, block.data);
        audioMime = block.mimeType;
        break;
      case "resource":
        text +=
          "text" in block.resource
            ? block.resource.text
            : `[resource: ${block.resource.uri}]`;
        break;
      case "resource_link":
        text += `[resource: ${block.uri}]`;
        break;
      default:
        text += `[${block.type}]`;
        break;
    }
  }

  return { text, imageUri, audioUri, audioMime };
}

const BubbleContainer = Paper.withProps({
  p: "md",
  radius: "md",
  withBorder: true,
});

const RoleLabel = Text.withProps({
  size: "xs",
  c: "dimmed",
  ff: "monospace",
});

const PreviewImage = Image.withProps({
  maw: 300,
  radius: "sm",
  mt: "xs",
});

export function MessageBubble({ index, message }: MessageBubbleProps) {
  const { text, imageUri, audioUri, audioMime } = extractContent(message);

  return (
    <BubbleContainer>
      <Stack gap="xs">
        <Group justify="space-between">
          <RoleLabel>{formatRoleLabel(index, message.role)}</RoleLabel>
          {text && <CopyButton value={text} />}
        </Group>
        {text && <Text size="sm">{formatQuotedContent(text)}</Text>}
        {imageUri && <PreviewImage src={imageUri} />}
        {audioUri && (
          <audio controls>
            <source src={audioUri} type={audioMime} />
          </audio>
        )}
      </Stack>
    </BubbleContainer>
  );
}
