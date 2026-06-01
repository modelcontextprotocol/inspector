import {
  CloseButton,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";

export interface OutputValidationModalProps {
  opened: boolean;
  onClose: () => void;
  /** The app tool whose result failed output-schema validation. */
  toolName?: string;
  /** The full validation error message (one issue per line). */
  message?: string;
}

/**
 * Shows the full output-schema validation error for an MCP App tool result.
 * The inspector still renders the app (the result is forwarded verbatim to the
 * view), but the result violates the tool's declared `outputSchema`, so strict
 * MCP clients may refuse to render it — this modal surfaces the details a
 * server developer needs to fix it. Opened from the warning toast.
 */
export function OutputValidationModal({
  opened,
  onClose,
  toolName,
  message,
}: OutputValidationModalProps) {
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
          <Title order={4} flex={1}>
            Output schema validation
          </Title>
          <CloseButton aria-label="Close" onClick={onClose} />
        </Group>
        <Text size="sm" c="dimmed">
          {toolName
            ? `"${toolName}" returned structuredContent that does not match its declared outputSchema. The inspector renders the app anyway, but strict MCP clients may refuse to display it.`
            : "The tool result's structuredContent does not match the declared outputSchema. The inspector renders the app anyway, but strict MCP clients may refuse to display it."}
        </Text>
        <Textarea
          aria-label="Validation details"
          readOnly
          autosize
          minRows={6}
          maxRows={18}
          value={message ?? ""}
        />
      </Stack>
    </Modal>
  );
}
