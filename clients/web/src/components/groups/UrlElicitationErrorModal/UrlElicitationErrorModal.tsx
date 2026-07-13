import {
  CloseButton,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";

export interface UrlElicitationErrorModalProps {
  opened: boolean;
  onClose: () => void;
  /** The tool whose call returned the URL-elicitation-required error. */
  toolName?: string;
  /** The raw error body (message + data), pretty-printed for inspection. */
  details?: string;
}

/**
 * Surfaces the raw body of a `URLElicitationRequired` (`-32042`) error that
 * carried no `elicitations` list — a non-spec server response the inspector
 * can't act on (there's no URL to open). The Tools screen shows a short toast;
 * this modal, opened from that toast, exposes the full error so a server
 * developer can see what the server actually returned.
 */
export function UrlElicitationErrorModal({
  opened,
  onClose,
  toolName,
  details,
}: UrlElicitationErrorModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      size="lg"
      centered
    >
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap">
          {/* `Modal.Title` names the dialog (wires `aria-labelledby`). */}
          <Modal.Title flex={1}>URL elicitation required</Modal.Title>
          <CloseButton aria-label="Close" onClick={onClose} />
        </Group>
        <Text size="sm" c="dimmed">
          {toolName
            ? `"${toolName}" returned a URLElicitationRequired (-32042) error with no required elicitations. Per the MCP spec the error must list the URL elicitations to complete before retrying, so the inspector has nothing to open.`
            : "The server returned a URLElicitationRequired (-32042) error with no required elicitations. Per the MCP spec the error must list the URL elicitations to complete before retrying, so the inspector has nothing to open."}
        </Text>
        <Textarea
          aria-label="Error details"
          readOnly
          autosize
          minRows={6}
          maxRows={18}
          value={details ?? ""}
        />
      </Stack>
    </Modal>
  );
}
