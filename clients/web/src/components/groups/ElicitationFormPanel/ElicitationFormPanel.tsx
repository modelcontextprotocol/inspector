import {
  Alert,
  Button,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import {
  hasMissingRequiredFields,
  type JsonSchemaType,
} from "../../../utils/jsonUtils";
import { SchemaForm } from "../SchemaForm/SchemaForm";

export interface ElicitationFormPanelProps {
  request: ElicitRequestFormParams;
  serverName: string;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  onSubmit: () => void;
  /** Explicit refusal to provide the data (maps to the spec's `decline`). */
  onDecline: () => void;
  /** Dismissal without an explicit choice (maps to the spec's `cancel`). */
  onCancel: () => void;
  /**
   * A response has been dispatched; lock the actions so a second click can't
   * resolve the request twice (the underlying handler throws if called again).
   */
  busy?: boolean;
}

const QuotedMessage = Text.withProps({
  size: "md",
  fs: "italic",
});

// Only the form fields scroll — capping them here keeps the quoted message
// above and the warning + action buttons below always in view, so the modal
// (which has no other close affordance) can always be dismissed without
// scrolling to the bottom. The cap reserves ~15rem for that pinned chrome so
// the whole panel stays within the modal's height.
const FieldScroll = ScrollArea.Autosize.withProps({
  mah: "calc(85dvh - 15rem)",
  offsetScrollbars: true,
});

function formatQuoted(text: string): string {
  return `\u201C${text}\u201D`;
}

function formatWarning(serverName: string): string {
  return `Only provide information you trust this server with. The server \u201C${serverName}\u201D is requesting this data.`;
}

export function ElicitationFormPanel({
  request,
  serverName,
  values,
  onChange,
  onSubmit,
  onDecline,
  onCancel,
  busy = false,
}: ElicitationFormPanelProps) {
  const requestedSchema = request.requestedSchema as JsonSchemaType;
  const submitDisabled =
    busy || hasMissingRequiredFields(requestedSchema, values);
  return (
    <Stack gap="md">
      <QuotedMessage>{formatQuoted(request.message)}</QuotedMessage>
      <Divider />
      <FieldScroll>
        <SchemaForm
          schema={requestedSchema}
          values={values}
          onChange={onChange}
          disabled={busy}
        />
      </FieldScroll>
      <Alert variant="warning" title="Warning">
        {formatWarning(serverName)}
      </Alert>
      <Group justify="flex-end">
        <Button variant="light" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="light" color="red" onClick={onDecline} disabled={busy}>
          Decline
        </Button>
        <Button onClick={onSubmit} disabled={submitDisabled}>
          Submit
        </Button>
      </Group>
    </Stack>
  );
}
