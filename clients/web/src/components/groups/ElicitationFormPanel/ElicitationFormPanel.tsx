import {
  Alert,
  Button,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/client";
import type { PendingRequestOrigin } from "@inspector/core/mcp/types.js";
import {
  hasMissingRequiredFields,
  type InspectorFormSchema,
} from "../../../utils/jsonUtils";
import { SchemaForm } from "../SchemaForm/SchemaForm";
import { MrtrOriginNote } from "../../elements/MrtrOriginNote/MrtrOriginNote";

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
   * How the request reached the Inspector — a legacy server→client request or a
   * modern MRTR `input_required` round. Drives the era-accurate note; defaults
   * to `"server-request"` (legacy, note hidden). (#1704)
   */
  origin?: PendingRequestOrigin;
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

// Only the form fields scroll; the message stays above and the warning + action
// buttons stay below (in normal flow), always in view — the modal has no other
// close affordance, so the actions must never scroll out of reach. Capping the
// fields at the modal's max height (≈90dvh) minus the ~22rem of non-field chrome
// (modal header/padding + message + warning + buttons + gaps) keeps the whole
// modal within the viewport. `ScrollArea.Autosize` sizes to content when the
// form is short (nothing scrolls, modal stays compact) and scrolls once the
// fields hit the cap.
const FieldScroll = ScrollArea.Autosize.withProps({
  mah: "calc(90dvh - 22rem)",
  scrollbars: "y",
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
  origin = "server-request",
  busy = false,
}: ElicitationFormPanelProps) {
  const requestedSchema = request.requestedSchema as InspectorFormSchema;
  const submitDisabled =
    busy || hasMissingRequiredFields(requestedSchema, values);
  return (
    <Stack gap="md">
      <QuotedMessage>{formatQuoted(request.message)}</QuotedMessage>
      <MrtrOriginNote origin={origin} />
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
