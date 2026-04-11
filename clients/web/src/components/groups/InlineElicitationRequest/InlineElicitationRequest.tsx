import {
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import type { JsonSchema } from "../SchemaForm/SchemaForm";
import { SchemaForm } from "../SchemaForm/SchemaForm";

export interface InlineElicitationRequestProps {
  mode: "form" | "url";
  message: string;
  queuePosition: string;
  schema?: JsonSchema;
  values?: Record<string, unknown>;
  url?: string;
  isWaiting?: boolean;
  onChange: (values: Record<string, unknown>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

const RequestContainer = Paper.withProps({
  p: "md",
  withBorder: true,
});

const QueueLabel = Text.withProps({
  size: "xs",
  c: "dimmed",
});

const ItalicMessage = Text.withProps({
  size: "sm",
  fs: "italic",
});

const ActionsRow = Group.withProps({
  justify: "flex-end",
  gap: "xs",
});

const CompactButton = Button.withProps({
  size: "xs",
  variant: "light",
});

function getBadgeLabel(mode: "form" | "url"): string {
  return mode === "form"
    ? "elicitation/create (form)"
    : "elicitation/create (url)";
}

export function InlineElicitationRequest({
  mode,
  message,
  queuePosition,
  schema,
  values,
  url,
  isWaiting,
  onChange,
  onSubmit,
  onCancel,
}: InlineElicitationRequestProps) {
  return (
    <RequestContainer>
      <Stack gap="sm">
        <Group justify="space-between">
          <Badge color="violet">{getBadgeLabel(mode)}</Badge>
          <QueueLabel>{queuePosition}</QueueLabel>
        </Group>

        <ItalicMessage>{message}</ItalicMessage>

        {mode === "form" && schema && (
          <SchemaForm
            schema={schema}
            values={values ?? {}}
            onChange={onChange}
          />
        )}

        {mode === "url" && url && (
          <>
            <Code block>{url}</Code>
            {isWaiting && (
              <Group>
                <Loader size="xs" />
                <Text size="xs">Waiting...</Text>
              </Group>
            )}
          </>
        )}

        <ActionsRow>
          <CompactButton onClick={onCancel}>Cancel</CompactButton>
          {mode === "form" && (
            <Button size="xs" onClick={onSubmit}>
              Submit
            </Button>
          )}
        </ActionsRow>
      </Stack>
    </RequestContainer>
  );
}
