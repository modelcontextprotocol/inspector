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
import type { ElicitRequest } from "@modelcontextprotocol/sdk/types.js";
import { SchemaForm } from "../SchemaForm/SchemaForm";
import type { JsonSchema } from "../SchemaForm/SchemaForm";

export interface InlineElicitationRequestProps {
  request: ElicitRequest["params"];
  queuePosition: string;
  values?: Record<string, unknown>;
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

function isFormMode(
  request: ElicitRequest["params"],
): request is ElicitRequest["params"] & {
  requestedSchema: Record<string, unknown>;
} {
  return "requestedSchema" in request;
}

function getBadgeLabel(request: ElicitRequest["params"]): string {
  return isFormMode(request)
    ? "elicitation/create (form)"
    : "elicitation/create (url)";
}

export function InlineElicitationRequest({
  request,
  queuePosition,
  values,
  isWaiting,
  onChange,
  onSubmit,
  onCancel,
}: InlineElicitationRequestProps) {
  const formMode = isFormMode(request);

  return (
    <RequestContainer>
      <Stack gap="sm">
        <Group justify="space-between">
          <Badge color="violet">{getBadgeLabel(request)}</Badge>
          <QueueLabel>{queuePosition}</QueueLabel>
        </Group>

        <ItalicMessage>{request.message}</ItalicMessage>

        {formMode && (
          <SchemaForm
            schema={request.requestedSchema as JsonSchema}
            values={values ?? {}}
            onChange={onChange}
          />
        )}

        {!formMode && "url" in request && (
          <>
            <Code block>{(request as { url: string }).url}</Code>
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
          {formMode && (
            <Button size="xs" onClick={onSubmit}>
              Submit
            </Button>
          )}
        </ActionsRow>
      </Stack>
    </RequestContainer>
  );
}
