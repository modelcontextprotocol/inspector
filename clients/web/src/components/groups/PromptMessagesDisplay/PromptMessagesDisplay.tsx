import { Button, Group, Stack, Text, Title } from "@mantine/core";
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

export function PromptMessagesDisplay({
  messages,
  onCopyAll,
}: PromptMessagesDisplayProps) {
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={4}>Messages</Title>
        {onCopyAll && messages.length > 0 && (
          <CopyAllButton onClick={onCopyAll}>Copy All</CopyAllButton>
        )}
      </Group>
      {messages.length === 0 ? (
        <Text c="dimmed">No messages to display</Text>
      ) : (
        messages.map((message, index) => (
          <MessageBubble key={index} index={index} message={message} />
        ))
      )}
    </Stack>
  );
}
