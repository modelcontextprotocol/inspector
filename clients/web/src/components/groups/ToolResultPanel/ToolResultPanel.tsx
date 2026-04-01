import { Button, Group, Stack, Text, Title } from "@mantine/core";
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
  variant: "light",
  size: "sm",
});

function resolveTextType(type: string): "text" | "json" {
  return type === "text" ? "text" : "json";
}

function resolveMediaType(mimeType?: string): "image" | "audio" {
  return mimeType?.startsWith("image") ? "image" : "audio";
}

export function ToolResultPanel({ content, onClear }: ToolResultPanelProps) {
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
                  type={resolveTextType(item.type)}
                  content={item.text}
                  copyable
                />
              );
            }
            if (item.data !== undefined) {
              return (
                <ContentViewer
                  key={index}
                  type={resolveMediaType(item.mimeType)}
                  content={item.data}
                  mimeType={item.mimeType}
                />
              );
            }
            return null;
          })}
        </>
      )}
      <Group>
        <ClearButton onClick={onClear}>Clear</ClearButton>
      </Group>
    </Stack>
  );
}
