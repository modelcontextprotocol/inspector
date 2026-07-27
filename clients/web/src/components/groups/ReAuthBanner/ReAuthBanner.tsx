import { Alert, Button, Group, Text } from "@mantine/core";

export const DEFAULT_REAUTH_BANNER_TITLE = "Re-authentication required";
export const DEFAULT_REAUTH_BANNER_ACTION_LABEL = "Re-authenticate";

export interface ReAuthBannerProps {
  message: string;
  /** Heading; defaults to {@link DEFAULT_REAUTH_BANNER_TITLE}. */
  title?: string;
  /** Action button label; defaults to {@link DEFAULT_REAUTH_BANNER_ACTION_LABEL}. */
  actionLabel?: string;
  onReauthenticate: () => void;
  onDismiss: () => void;
}

// `title` is intentionally not baked in here: the component always passes a
// resolved `title`, whose parameter default is the single source of truth.
const ReAuthAlert = Alert.withProps({
  color: "red",
  variant: "reauth",
  withCloseButton: true,
  // Mantine's close button renders icon-only; without a label it has no
  // accessible name (axe `button-name`).
  closeButtonLabel: "Dismiss",
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
  title = DEFAULT_REAUTH_BANNER_TITLE,
  actionLabel = DEFAULT_REAUTH_BANNER_ACTION_LABEL,
  onReauthenticate,
  onDismiss,
}: ReAuthBannerProps) {
  return (
    <ReAuthAlert title={title} onClose={onDismiss}>
      <BannerRow>
        <MessageText>{message}</MessageText>
        <ReAuthButton onClick={onReauthenticate}>{actionLabel}</ReAuthButton>
      </BannerRow>
    </ReAuthAlert>
  );
}
