import { Alert, Button, Group, Text } from "@mantine/core";

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
      variant="reauth"
      title="Re-authentication required"
      withCloseButton
      onClose={onDismiss}
    >
      <Group justify="space-between" align="center" wrap="nowrap" gap="md">
        <Text component="span" size="sm">
          {message}
        </Text>
        <Button size="xs" variant="filled" onClick={onReauthenticate}>
          Re-authenticate
        </Button>
      </Group>
    </Alert>
  );
}
