import {
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";

export interface InlineSamplingRequestProps {
  queuePosition: string;
  modelHints?: string[];
  messagePreview: string;
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

function formatModelHints(hints: string[]): string {
  return `Model hints: ${hints.join(", ")}`;
}

export function InlineSamplingRequest({
  queuePosition,
  modelHints,
  messagePreview,
  responseText,
  onAutoRespond,
  onEditAndSend,
  onReject,
  onViewDetails,
}: InlineSamplingRequestProps) {
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
