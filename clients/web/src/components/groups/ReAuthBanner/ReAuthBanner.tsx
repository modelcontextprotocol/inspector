import { Alert, Button, Group } from "@mantine/core";

export interface ReAuthBannerProps {
  message: string;
  onReauthenticate: () => void;
  onDismiss: () => void;
}

export function ReAuthBanner({
  message,
  onReauthenticate,
  onDismiss,
}: ReAuthBannerProps) {
  return (
    <Alert
      color="red"
      variant="light"
      title="Re-authentication required"
      withCloseButton
      onClose={onDismiss}
      styles={{
        root: {
          backgroundColor: "var(--mantine-color-body)",
          border: "1px solid var(--mantine-color-red-3)",
        },
      }}
    >
      <Group justify="space-between" align="center" wrap="nowrap" gap="md">
        <span>{message}</span>
        <Button size="xs" variant="filled" onClick={onReauthenticate}>
          Re-authenticate
        </Button>
      </Group>
    </Alert>
  );
}
