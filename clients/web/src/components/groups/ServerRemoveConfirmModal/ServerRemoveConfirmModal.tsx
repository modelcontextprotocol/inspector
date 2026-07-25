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
  bg: "var(--inspector-surface-subtle)",
  withBorder: true,
});
const RemoveServerModal = Modal.withProps({
  size: "md",
  centered: true,
  title: "Remove server?",
});
const BoldInline = Text.withProps({ component: "span", fw: 600 });
const IdText = Text.withProps({ size: "sm", fw: 600 });
const DimText = Text.withProps({ size: "xs", c: "dimmed" });
const FieldError = Text.withProps({ c: "red", size: "sm", role: "alert" });

function summarize(config: ServerEntry["config"] | undefined): string {
  /* v8 ignore next -- defensive guard: every ServerEntry has a non-optional
     config, so summarize is never called with undefined in practice. */
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
    <RemoveServerModal opened={opened} onClose={onCancel}>
      <Stack gap="md">
        <Text size="sm">
          The entry will be removed from{" "}
          <BoldInline>~/.mcp-inspector/mcp.json</BoldInline>. You can add it
          back at any time.
        </Text>
        {target ? (
          <Summary>
            <Stack gap={4}>
              <IdText>{target.id}</IdText>
              <DimText>
                {target.config.type ?? "stdio"} · {summarize(target.config)}
              </DimText>
            </Stack>
          </Summary>
        ) : null}
        {error ? <FieldError>{error}</FieldError> : null}
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
    </RemoveServerModal>
  );
}
