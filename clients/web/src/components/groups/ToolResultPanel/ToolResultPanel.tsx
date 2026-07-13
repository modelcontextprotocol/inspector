import {
  Alert,
  CloseButton,
  Group,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { ResourceLink } from "../ResourceLink/ResourceLink";

export interface ToolResultPanelProps {
  result: CallToolResult;
  /**
   * Dismiss the result and return to the input form (#1661). Mirrors the
   * Prompts screen: the result replaces the form while present, and the
   * top-left X flips back to the form so the tool can be re-run.
   */
  onClear: () => void;
  /**
   * Read-on-demand handler so `resource_link` blocks in the result can fetch
   * and inline their contents.
   */
  onReadResource?: (uri: string) => Promise<ReadResourceResult>;
}

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

// Close button + title, mirroring PromptMessagesDisplay so the two result
// panels dismiss the same way.
const HeaderLeft = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
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

export function ToolResultPanel({
  result,
  onClear,
  onReadResource,
}: ToolResultPanelProps) {
  return (
    <PanelStack>
      <HeaderRow>
        <HeaderLeft>
          <CloseButton aria-label="Close results" onClick={onClear} />
          {/* h3 (not h4), size h4: request modals open over the Tools screen
              with an `h2` `Modal.Title`, so an `h4` here would skip a level
              (axe `heading-order`); `size="h4"` preserves the visual size. */}
          <Title order={3} size="h4">
            Results
          </Title>
        </HeaderLeft>
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
            result.content.map((block, index) =>
              block.type === "resource_link" ? (
                <ResourceLink
                  key={index}
                  uri={block.uri}
                  name={block.name}
                  description={block.description}
                  mimeType={block.mimeType}
                  onReadResource={onReadResource}
                />
              ) : (
                <ContentViewer
                  key={index}
                  block={block}
                  copyable={block.type === "text"}
                />
              ),
            )
          )}
        </ResultStack>
      </ResultScroll>
    </PanelStack>
  );
}
