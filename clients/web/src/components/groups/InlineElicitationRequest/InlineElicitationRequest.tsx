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
import type {
  ElicitRequest,
  ElicitRequestFormParams,
} from "@modelcontextprotocol/client";
import type { PendingRequestOrigin } from "@inspector/core/mcp/types.js";
import type { InspectorFormSchema } from "../../../utils/jsonUtils";
import { SchemaForm } from "../SchemaForm/SchemaForm";
import { MrtrOriginNote } from "../../elements/MrtrOriginNote/MrtrOriginNote";

export interface InlineElicitationRequestProps {
  request: ElicitRequest["params"];
  queuePosition: string;
  values?: Record<string, unknown>;
  isWaiting?: boolean;
  /**
   * How the request reached the Inspector — a legacy server→client request or a
   * modern MRTR `input_required` round. Drives the era-accurate note; defaults
   * to `"server-request"` (legacy, note hidden). (#1704)
   */
  origin?: PendingRequestOrigin;
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
): request is ElicitRequestFormParams {
  return "requestedSchema" in request;
}

function isUrlMode(
  request: ElicitRequest["params"],
): request is Extract<ElicitRequest["params"], { mode: "url" }> {
  return "url" in request;
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
  origin = "server-request",
  onChange,
  onSubmit,
  onCancel,
}: InlineElicitationRequestProps) {
  return (
    <RequestContainer>
      <Stack gap="sm">
        <Group justify="space-between">
          <Badge color="violet">{getBadgeLabel(request)}</Badge>
          <QueueLabel>{queuePosition}</QueueLabel>
        </Group>

        <ItalicMessage>{request.message}</ItalicMessage>
        <MrtrOriginNote origin={origin} />

        {isFormMode(request) && (
          <SchemaForm
            schema={request.requestedSchema as InspectorFormSchema}
            values={values ?? {}}
            onChange={onChange}
          />
        )}

        {isUrlMode(request) && (
          <>
            <Code block>{request.url}</Code>
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
          {isFormMode(request) && (
            <Button size="xs" onClick={onSubmit}>
              Submit
            </Button>
          )}
        </ActionsRow>
      </Stack>
    </RequestContainer>
  );
}
