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

// Fill the (bounded) modal body and lay out as a flex column: the message and
// the warning + action buttons are pinned (`flex: 0 0 auto`) and only the
// fields scroll, so the buttons stay in view no matter how tall the form is —
// the modal has no other close affordance. `PendingClientRequestModal` makes
// its body a bounded flex column so `flex: 1` here has a definite height to
// fill (and to size to content when the form is short).
const PanelStack = Stack.withProps({
  gap: "md",
  flex: 1,
  mih: 0,
});

const PinnedSection = Stack.withProps({ gap: "md", flex: "0 0 auto" });

// The fields are the only scrolling region. `flex: "0 1 auto"` (basis auto) sizes
// it to its content when the form is short — so the modal stays compact and
// nothing scrolls — but lets it shrink and scroll once the panel is capped at
// the modal's max height, keeping the pinned sections in view. (Same pattern as
// ToolDetailPanel's body scroller.)
const FieldScroll = ScrollArea.withProps({
  flex: "0 1 auto",
  mih: 0,
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
  busy = false,
}: ElicitationFormPanelProps) {
  const requestedSchema = request.requestedSchema as JsonSchemaType;
  const submitDisabled =
    busy || hasMissingRequiredFields(requestedSchema, values);
  return (
    <PanelStack>
      <PinnedSection>
        <QuotedMessage>{formatQuoted(request.message)}</QuotedMessage>
        <Divider />
      </PinnedSection>
      <FieldScroll>
        <SchemaForm
          schema={requestedSchema}
          values={values}
          onChange={onChange}
          disabled={busy}
        />
      </FieldScroll>
      <PinnedSection>
        <Alert variant="warning" title="Warning">
          {formatWarning(serverName)}
        </Alert>
        <Group justify="flex-end">
          <Button variant="light" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="light"
            color="red"
            onClick={onDecline}
            disabled={busy}
          >
            Decline
          </Button>
          <Button onClick={onSubmit} disabled={submitDisabled}>
            Submit
          </Button>
        </Group>
      </PinnedSection>
    </PanelStack>
  );
}
