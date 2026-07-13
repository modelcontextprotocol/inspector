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

// Cap the whole panel below the modal's max height (≈90dvh, minus its header
// and padding) and lay it out as a flex column: the message and the
// warning + action buttons are pinned (`flex: 0 0 auto`) and only the fields
// (`FieldScroll`, `flex: 1`) shrink and scroll to absorb the overflow. This
// keeps the buttons in view no matter how tall the form is — the modal has no
// other close affordance, so the actions must never scroll off-screen.
const PanelStack = Stack.withProps({
  gap: "md",
  mah: "calc(85dvh - 8rem)",
  mih: 0,
});

const PinnedSection = Stack.withProps({ gap: "md", flex: "0 0 auto" });

const FieldScroll = ScrollArea.withProps({
  flex: 1,
  mih: 0,
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
