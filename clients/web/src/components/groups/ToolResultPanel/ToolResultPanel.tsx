import { Button, Group, Stack, Text, Title } from "@mantine/core";
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";

export interface ResultContentItem {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolResultPanelProps {
  content: ResultContentItem[];
  onClear: () => void;
}

const ClearButton = Button.withProps({
  variant: "subtle",
  size: "sm",
});

function toContentBlock(item: ResultContentItem): ContentBlock | null {
  if (item.text !== undefined) {
    return { type: "text", text: item.text };
  }
  if (item.data !== undefined && item.mimeType?.startsWith("image")) {
    return { type: "image", data: item.data, mimeType: item.mimeType };
  }
  if (item.data !== undefined && item.mimeType) {
    return { type: "audio", data: item.data, mimeType: item.mimeType };
  }
  return null;
}

export function ToolResultPanel({ content, onClear }: ToolResultPanelProps) {
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={4}>Results</Title>
        <ClearButton onClick={onClear}>Clear</ClearButton>
      </Group>
      {content.length === 0 ? (
        <Text c="dimmed">No results yet</Text>
      ) : (
        <>
          {content.map((item, index) => {
            const block = toContentBlock(item);
            if (!block) return null;
            return (
              <ContentViewer
                key={index}
                block={block}
                copyable={block.type === "text"}
              />
            );
          })}
        </>
      )}
    </Stack>
  );
}
