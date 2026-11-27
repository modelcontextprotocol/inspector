import { Button, Code, Group } from "@mantine/core";
import { MASKED_WEBHOOK_SECRET } from "@inspector/core/extension/events/webhookSecret.js";
import { CopyButton } from "../CopyButton/CopyButton";

export interface WebhookSecretFieldProps {
  /** The real secret: copied to the clipboard, never rendered. */
  secret: string;
  /** Offer a fresh secret in place of this one (the subscribe form only). */
  onRegenerate?: () => void;
}

const SecretRow = Group.withProps({
  gap: 4,
  wrap: "nowrap",
  align: "center",
});

const RegenerateButton = Button.withProps({
  size: "compact-xs",
  variant: "default",
});

/**
 * A webhook signing secret (SEP-3415, #3031), shown masked with a copy
 * control. The value is never put in the DOM — only the clipboard receives it
 * — because the receiver needs it and nobody needs to read it, and a screen
 * share or a screenshot should not leak the credential that verifies
 * deliveries. There is no field to type one: the spec asks clients not to
 * encourage hand-picked secrets, so the only alternative offered is a freshly
 * generated one.
 */
export function WebhookSecretField({
  secret,
  onRegenerate,
}: WebhookSecretFieldProps) {
  return (
    <SecretRow>
      <Code>{MASKED_WEBHOOK_SECRET}</Code>
      <CopyButton value={secret} label="webhook secret" />
      {onRegenerate && (
        <RegenerateButton onClick={onRegenerate}>Regenerate</RegenerateButton>
      )}
    </SecretRow>
  );
}
