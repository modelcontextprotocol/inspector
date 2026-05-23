import { useState } from "react";
import { Button, Group, Modal, Paper, Stack, Text } from "@mantine/core";
import type { ServerEntry } from "@inspector/core/mcp/types.js";

export interface ServerRemoveConfirmModalProps {
  opened: boolean;
  /** The server about to be removed; null when the modal is closed. */
  target: ServerEntry | null;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

const Actions = Group.withProps({ justify: "flex-end", gap: "sm", mt: "md" });
const Summary = Paper.withProps({
  p: "sm",
  radius: "sm",
  bg: "var(--mantine-color-default-hover)",
  withBorder: true,
});

function summarize(config: ServerEntry["config"] | undefined): string {
  if (!config) return "";
  // StdioServerConfig has `type?: "stdio"` (optional), which means
  // `config.type === "stdio"` doesn't narrow away the undefined-type stdio
  // case. Discriminate on the unique field instead — stdio has command,
  // sse/streamable-http have url.
  if ("url" in config) return config.url;
  return [config.command, ...(config.args ?? [])].join(" ");
}

export function ServerRemoveConfirmModal({
  opened,
  target,
  onConfirm,
  onCancel,
}: ServerRemoveConfirmModalProps) {
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleConfirm() {
    if (!target) return;
    setError(undefined);
    setSubmitting(true);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      size="md"
      centered
      title="Remove server?"
    >
      <Stack gap="md">
        <Text size="sm">
          The entry will be removed from{" "}
          <Text component="span" fw={600}>
            ~/.mcp-inspector/mcp.json
          </Text>
          . You can add it back at any time.
        </Text>
        {target ? (
          <Summary>
            <Stack gap={4}>
              <Text size="sm" fw={600}>
                {target.id}
              </Text>
              <Text size="xs" c="dimmed">
                {target.config.type ?? "stdio"} · {summarize(target.config)}
              </Text>
            </Stack>
          </Summary>
        ) : null}
        {error ? (
          <Text c="red" size="sm" role="alert">
            {error}
          </Text>
        ) : null}
        <Actions>
          <Button variant="default" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            color="red"
            onClick={() => {
              void handleConfirm();
            }}
            loading={submitting}
          >
            Remove
          </Button>
        </Actions>
      </Stack>
    </Modal>
  );
}
