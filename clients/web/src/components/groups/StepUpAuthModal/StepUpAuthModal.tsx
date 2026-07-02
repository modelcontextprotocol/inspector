import { Button, Group, List, Modal, Stack, Text } from "@mantine/core";
import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import {
  stepUpAdditionalScopes,
  stepUpConfirmMessage,
  stepUpFollowUpMessage,
  stepUpModalTitle,
} from "@inspector/core/auth/oauthUx.js";

export interface StepUpAuthModalProps {
  opened: boolean;
  challenge: AuthChallenge | null;
  /** Effective consent scope set (SEP-2350 union). */
  authorizationScopes?: string[];
  /** Enterprise-managed (EMA) server — organization/IdP copy instead of resource AS. */
  enterpriseManaged?: boolean;
  onAuthorize: () => void | Promise<void>;
  onCancel: () => void;
}

const Actions = Group.withProps({ justify: "flex-end", gap: "sm", mt: "md" });

export function StepUpAuthModal({
  opened,
  challenge,
  authorizationScopes,
  enterpriseManaged,
  onAuthorize,
  onCancel,
}: StepUpAuthModalProps) {
  const additionalScopes = challenge ? stepUpAdditionalScopes(challenge) : [];
  const ema = enterpriseManaged === true;

  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      size="md"
      centered
      title={stepUpModalTitle({ enterpriseManaged: ema })}
    >
      <Stack gap="md">
        <Text size="sm">
          {challenge
            ? stepUpConfirmMessage(challenge, { enterpriseManaged: ema })
            : stepUpConfirmMessage(
                { reason: "insufficient_scope" },
                { enterpriseManaged: ema },
              )}{" "}
          {stepUpFollowUpMessage({ enterpriseManaged: ema })}
        </Text>
        {additionalScopes.length > 0 ? (
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              {ema
                ? "Additional permissions needed"
                : "Additional scopes needed"}
            </Text>
            <List size="sm" spacing="xs">
              {additionalScopes.map((scope) => (
                <List.Item key={scope}>
                  <Text component="span" ff="monospace" size="sm">
                    {scope}
                  </Text>
                </List.Item>
              ))}
            </List>
            {!ema &&
            authorizationScopes &&
            authorizationScopes.length > additionalScopes.length ? (
              <Text size="xs" c="dimmed">
                The authorization server may also show scopes you already
                granted during sign-in.
              </Text>
            ) : null}
          </Stack>
        ) : null}
        <Actions>
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => void onAuthorize()}>Authorize</Button>
        </Actions>
      </Stack>
    </Modal>
  );
}
