import { Badge, Button, Group, List, Modal, Stack, Text } from "@mantine/core";
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

const ScopeToken = Text.withProps({
  component: "span",
  ff: "monospace",
  size: "sm",
});

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
  const handleAuthorize = () => void onAuthorize();

  // SEP-2350: `authorizationScopes` is the union the client will re-authorize
  // with (previously requested ∪ challenged). Split it so the user sees exactly
  // what carries over versus what the failing operation newly requires.
  const additionalSet = new Set(additionalScopes);
  const unionScopes = authorizationScopes ?? additionalScopes;
  const carriedOverScopes = unionScopes.filter(
    (scope) => !additionalSet.has(scope),
  );
  const showUnion = !ema && carriedOverScopes.length > 0;

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
        {showUnion ? (
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Scopes to authorize
            </Text>
            <Text size="xs" c="dimmed">
              Re-authorizing with the union of your previously granted scopes
              and the ones this operation requires, so the new token keeps every
              grant (SEP-2350).
            </Text>
            <List size="sm" spacing="xs" listStyleType="none">
              {unionScopes.map((scope) => (
                <List.Item key={scope}>
                  <Group gap="xs" wrap="nowrap">
                    <ScopeToken>{scope}</ScopeToken>
                    <Badge
                      size="xs"
                      variant="light"
                      color={additionalSet.has(scope) ? "blue" : "gray"}
                    >
                      {additionalSet.has(scope) ? "new" : "already granted"}
                    </Badge>
                  </Group>
                </List.Item>
              ))}
            </List>
          </Stack>
        ) : additionalScopes.length > 0 ? (
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              {ema
                ? "Additional permissions needed"
                : "Additional scopes needed"}
            </Text>
            <List size="sm" spacing="xs">
              {additionalScopes.map((scope) => (
                <List.Item key={scope}>
                  <ScopeToken>{scope}</ScopeToken>
                </List.Item>
              ))}
            </List>
          </Stack>
        ) : null}
        <Actions>
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleAuthorize}>Authorize</Button>
        </Actions>
      </Stack>
    </Modal>
  );
}
