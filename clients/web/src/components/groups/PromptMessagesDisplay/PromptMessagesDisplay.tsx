import { Button, Group, ScrollArea, Stack, Text, Title } from "@mantine/core";
import type { PromptMessage } from "@modelcontextprotocol/sdk/types.js";
import { MessageBubble } from "../../elements/MessageBubble/MessageBubble";

export interface PromptMessagesDisplayProps {
  messages: PromptMessage[];
  onCopyAll?: () => void;
}

const CopyAllButton = Button.withProps({
  variant: "subtle",
  size: "sm",
});

// Outer stack inside the PreviewCard: header stays pinned, the scroll
// region absorbs overflow. Mirrors ResourcePreviewPanel so prompts and
// resources share the same sized-to-content / cap-then-scroll behavior.
const PanelStack = Stack.withProps({
  gap: "md",
  miw: 0,
  mih: 0,
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  flex: "0 0 auto",
});

// `0 1 auto` lets the scroll region shrink (but not grow) when the card
// hits its mah. `mih: 0` is required for flex children to shrink below
// their content's intrinsic height.
const MessagesScroll = ScrollArea.withProps({
  flex: "0 1 auto",
  miw: 0,
  mih: 0,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const MessagesStack = Stack.withProps({
  gap: "md",
});

export function PromptMessagesDisplay({
  messages,
  onCopyAll,
}: PromptMessagesDisplayProps) {
  return (
    <PanelStack>
      <HeaderRow>
        <Title order={4}>Messages</Title>
        {onCopyAll && messages.length > 0 && (
          <CopyAllButton onClick={onCopyAll}>Copy All</CopyAllButton>
        )}
      </HeaderRow>
      <MessagesScroll>
        <MessagesStack>
          {messages.length === 0 ? (
            <Text c="dimmed">No messages to display</Text>
          ) : (
            messages.map((message, index) => (
              <MessageBubble key={index} index={index} message={message} />
            ))
          )}
        </MessagesStack>
      </MessagesScroll>
    </PanelStack>
  );
}
