import { Button, Group, Stack, Text, Title } from "@mantine/core";
import { MessageBubble } from "../../atoms/MessageBubble/MessageBubble";

export interface PromptMessage {
  role: string;
  content: string;
  imageContent?: { data: string; mimeType: string };
  audioContent?: { data: string; mimeType: string };
}

export interface PromptMessagesDisplayProps {
  messages: PromptMessage[];
  onCopyAll?: () => void;
}

export function PromptMessagesDisplay({
  messages,
  onCopyAll,
}: PromptMessagesDisplayProps) {
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={4}>Messages</Title>
        {onCopyAll && messages.length > 0 && (
          <Button variant="light" size="sm" onClick={onCopyAll}>
            Copy All
          </Button>
        )}
      </Group>
      {messages.length === 0 ? (
        <Text c="dimmed">No messages to display</Text>
      ) : (
        messages.map((message, index) => (
          <MessageBubble
            key={index}
            index={index}
            role={message.role as "user" | "assistant"}
            content={message.content}
            imageContent={message.imageContent}
            audioContent={message.audioContent}
          />
        ))
      )}
    </Stack>
  );
}
