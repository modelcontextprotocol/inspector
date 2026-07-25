import { Alert, Button, Group, Text } from "@mantine/core";

export interface ReAuthBannerProps {
  message: string;
  onReauthenticate: () => void;
  onDismiss: () => void;
}

const ReAuthAlert = Alert.withProps({
  color: "red",
  variant: "reauth",
  title: "Re-authentication required",
  withCloseButton: true,
});

const BannerRow = Group.withProps({
  justify: "space-between",
  align: "center",
  wrap: "nowrap",
  gap: "md",
});

const MessageText = Text.withProps({
  component: "span",
  size: "sm",
});

const ReAuthButton = Button.withProps({
  size: "xs",
  variant: "filled",
});

export function ReAuthBanner({
  message,
  onReauthenticate,
  onDismiss,
}: ReAuthBannerProps) {
  return (
    <ReAuthAlert onClose={onDismiss}>
      <BannerRow>
        <MessageText>{message}</MessageText>
        <ReAuthButton onClick={onReauthenticate}>Re-authenticate</ReAuthButton>
      </BannerRow>
    </ReAuthAlert>
  );
}
