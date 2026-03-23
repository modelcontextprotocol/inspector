import { Stack, Text, Title } from "@mantine/core";
import { MessageBubble } from "../../atoms/MessageBubble/MessageBubble";

export interface PromptMessage {
  role: string;
  content: string;
  imageContent?: { data: string; mimeType: string };
  audioContent?: { data: string; mimeType: string };
}

export interface PromptMessagesDisplayProps {
  messages: PromptMessage[];
}

export function PromptMessagesDisplay({
  messages,
}: PromptMessagesDisplayProps) {
  return (
    <Stack gap="md">
      <Title order={4}>Messages</Title>
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
