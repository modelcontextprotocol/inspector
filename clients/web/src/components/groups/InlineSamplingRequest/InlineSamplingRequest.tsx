import {
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import type { CreateMessageRequestParams } from "@modelcontextprotocol/sdk/types.js";

export interface InlineSamplingRequestProps {
  request: CreateMessageRequestParams;
  queuePosition: string;
  responseText: string;
  onAutoRespond: () => void;
  onEditAndSend: () => void;
  onReject: () => void;
  onViewDetails: () => void;
}

const RequestContainer = Paper.withProps({
  p: "md",
  withBorder: true,
});

const QueueLabel = Text.withProps({
  size: "xs",
  c: "dimmed",
});

const PreviewText = Text.withProps({
  size: "sm",
  c: "dimmed",
  lineClamp: 2,
});

const DetailButton = Button.withProps({
  variant: "subtle",
  size: "xs",
});

const ActionsRow = Group.withProps({
  justify: "flex-end",
  gap: "xs",
});

const CompactButton = Button.withProps({
  size: "xs",
  variant: "light",
});

const RejectButton = Button.withProps({
  size: "xs",
  variant: "light",
  color: "red",
});

function extractPreview(request: CreateMessageRequestParams): string {
  const lastMessage = request.messages[request.messages.length - 1];
  if (!lastMessage) return "";
  const content = lastMessage.content;
  if (Array.isArray(content)) {
    const textBlock = content.find((b) => b.type === "text");
    return textBlock && "text" in textBlock ? textBlock.text : "";
  }
  return content.type === "text" ? content.text : `[${content.type}]`;
}

function extractModelHints(
  request: CreateMessageRequestParams,
): string[] | undefined {
  const hints = request.modelPreferences?.hints;
  if (!hints || hints.length === 0) return undefined;
  return hints.map((h) => h.name).filter(Boolean) as string[];
}

function formatModelHints(hints: string[]): string {
  return `Model hints: ${hints.join(", ")}`;
}

export function InlineSamplingRequest({
  request,
  queuePosition,
  responseText,
  onAutoRespond,
  onEditAndSend,
  onReject,
  onViewDetails,
}: InlineSamplingRequestProps) {
  const modelHints = extractModelHints(request);
  const messagePreview = extractPreview(request);

  return (
    <RequestContainer>
      <Stack gap="sm">
        <Group justify="space-between">
          <Badge color="blue">sampling/createMessage</Badge>
          <QueueLabel>{queuePosition}</QueueLabel>
        </Group>

        {modelHints && <Text size="sm">{formatModelHints(modelHints)}</Text>}

        <PreviewText>{messagePreview}</PreviewText>

        <DetailButton onClick={onViewDetails}>View Details</DetailButton>

        <Textarea
          size="sm"
          value={responseText}
          placeholder="Response..."
          autosize
          minRows={2}
          readOnly
        />

        <ActionsRow>
          <CompactButton onClick={onAutoRespond}>Auto-respond</CompactButton>
          <CompactButton onClick={onEditAndSend}>Edit &amp; Send</CompactButton>
          <RejectButton onClick={onReject}>Reject</RejectButton>
        </ActionsRow>
      </Stack>
    </RequestContainer>
  );
}
