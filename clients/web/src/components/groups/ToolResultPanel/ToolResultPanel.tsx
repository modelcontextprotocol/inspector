import {
  Alert,
  Button,
  Group,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
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

// Outer column: the header pins (`flex: 0 0 auto`) and the scroll region
// absorbs overflow when the enclosing card hits its `mah`. `mih: 0` lets the
// flex children shrink below their content's intrinsic height.
const PanelStack = Stack.withProps({
  gap: "md",
  miw: 0,
  mih: 0,
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  flex: "0 0 auto",
});

// `0 1 auto` + `mih: 0` lets the scroll region shrink (never grow) so a short
// result doesn't reserve height while a long one scrolls within the card cap.
const ResultScroll = ScrollArea.withProps({
  flex: "0 1 auto",
  miw: 0,
  mih: 0,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const ResultStack = Stack.withProps({
  gap: "md",
});

export function ToolResultPanel({ result, onClear }: ToolResultPanelProps) {
  return (
    <PanelStack>
      <HeaderRow>
        <Title order={4}>Results</Title>
        <ClearButton onClick={onClear}>Clear</ClearButton>
      </HeaderRow>
      <ResultScroll>
        <ResultStack>
          {result.isError ? (
            <Alert color="red" variant="light" title="Tool Error">
              {result.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n")}
            </Alert>
          ) : result.content.length === 0 ? (
            <Text c="dimmed">No results yet</Text>
          ) : (
            result.content.map((block, index) => (
              <ContentViewer
                key={index}
                block={block}
                copyable={block.type === "text"}
              />
            ))
          )}
        </ResultStack>
      </ResultScroll>
    </PanelStack>
  );
}
