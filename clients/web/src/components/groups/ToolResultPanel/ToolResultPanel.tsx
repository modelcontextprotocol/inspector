import { Button, Group, Stack, Text, Title } from "@mantine/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";

export interface ToolResultPanelProps {
  result: CallToolResult;
  onClear: () => void;
}

const ClearButton = Button.withProps({
  variant: "subtle",
  size: "sm",
});

export function ToolResultPanel({ result, onClear }: ToolResultPanelProps) {
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={4}>Results</Title>
        <ClearButton onClick={onClear}>Clear</ClearButton>
      </Group>
      {result.content.length === 0 ? (
        <Text c="dimmed">No results yet</Text>
      ) : (
        <>
          {result.content.map((block, index) => (
            <ContentViewer
              key={index}
              block={block}
              copyable={block.type === "text"}
            />
          ))}
        </>
      )}
    </Stack>
  );
}
