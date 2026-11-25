import { Button, Group, Paper, Stack, Text } from "@mantine/core";
import type { EventSubscription } from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import { DeliveryModeBadge } from "../../elements/DeliveryModeBadge/DeliveryModeBadge";
import { EventSubscriptionStatusBadge } from "../../elements/EventSubscriptionStatusBadge/EventSubscriptionStatusBadge";
import { WebhookSecretField } from "../../elements/WebhookSecretField/WebhookSecretField";
import {
  canResumeSubscription,
  describeDeliveryStatus,
  describeEventsError,
  describeWebhookError,
  formatCursor,
  formatInterval,
  formatRefreshBefore,
  formatSubscriptionArguments,
  formatTtlSuggestion,
  isSubscriptionLive,
  subscriptionInterval,
} from "../../../utils/eventsUtils";

export interface EventSubscriptionCardProps {
  subscription: EventSubscription;
  /** Whether the occurrence log is narrowed to this subscription. */
  logFiltered: boolean;
  onStop: () => void;
  onResume: () => void;
  onRemove: () => void;
  /** Narrow the occurrence log to this subscription, or widen it again. */
  onToggleLogFilter: () => void;
  /** Webhook: the signing secret, for the copy control (never rendered). */
  webhookSecret?: string;
  /** Webhook: send a refresh now rather than at the scheduled time. */
  onRefresh?: () => void;
}

const CardFrame = Paper.withProps({
  withBorder: true,
  p: "sm",
  radius: "sm",
});

const CardStack = Stack.withProps({
  gap: 6,
});

// The name gets a line of its own and the badges the next, so neither is
// squeezed when the column is narrow (the monitoring sidebar open beside it).
const BadgeRow = Group.withProps({
  gap: "xs",
});

const NameText = Text.withProps({
  fw: 600,
  size: "sm",
  truncate: "end",
});

const DetailRow = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
  align: "baseline",
});

const DetailLabel = Text.withProps({
  size: "xs",
  c: "var(--inspector-text-secondary)",
  w: 72,
  flex: "0 0 auto",
});

const DetailValue = Text.withProps({
  size: "xs",
  ff: "monospace",
  truncate: "end",
  miw: 0,
});

const CountsText = Text.withProps({
  size: "xs",
  c: "var(--inspector-text-secondary)",
});

const ErrorText = Text.withProps({
  size: "xs",
  c: "var(--inspector-danger-text)",
});

const ActionRow = Group.withProps({
  gap: "xs",
});

const ActionButton = Button.withProps({
  size: "compact-xs",
  variant: "default",
});

const StopButton = Button.withProps({
  size: "compact-xs",
  variant: "outline",
  color: "red",
});

const NoteText = Text.withProps({
  size: "xs",
  c: "var(--inspector-text-secondary)",
});

const UNSUBSCRIBE_LABELS = {
  pending: "Unsubscribing…",
  done: "Unsubscribed on the server.",
  gone: "Already gone on the server (it had lapsed or been dropped).",
  failed: "Unsubscribe failed",
} as const;

const RELIST_LABELS = {
  pending: "re-listing event types…",
  done: "event types re-listed",
  failed: "re-list failed",
  skipped: "no re-list",
} as const;

/**
 * One Events subscription (SEP-3415, #3030): its mode and state, the cursor it
 * would resume from, the granted heartbeat or recommended poll interval, its
 * tallies (including gaps and errors), the last error, how it ended, and the
 * controls to stop, resume or forget it.
 */
export function EventSubscriptionCard({
  subscription,
  logFiltered,
  onStop,
  onResume,
  onRemove,
  onToggleLogFilter,
  webhookSecret,
  onRefresh,
}: EventSubscriptionCardProps) {
  const {
    name,
    mode,
    status,
    cursor,
    counts,
    lastError,
    termination,
    webhook,
  } = subscription;
  const interval = subscriptionInterval(subscription);
  const live = isSubscriptionLive(subscription);
  // A webhook error has meanings of its own (an endpoint that failed
  // verification, an unauthenticated caller) worth spelling out.
  const describeError = webhook ? describeWebhookError : describeEventsError;

  return (
    <CardFrame data-testid="event-subscription" data-status={status}>
      <CardStack>
        <NameText>{name}</NameText>
        <BadgeRow>
          <DeliveryModeBadge mode={mode} />
          <EventSubscriptionStatusBadge status={status} />
        </BadgeRow>
        <DetailRow>
          <DetailLabel>Arguments</DetailLabel>
          <DetailValue>
            {formatSubscriptionArguments(subscription.arguments)}
          </DetailValue>
        </DetailRow>
        <DetailRow>
          <DetailLabel>Cursor</DetailLabel>
          <DetailValue>{formatCursor(cursor)}</DetailValue>
        </DetailRow>
        {interval && (
          <DetailRow>
            <DetailLabel>{interval.label}</DetailLabel>
            <DetailValue>{formatInterval(interval.ms)}</DetailValue>
          </DetailRow>
        )}
        {webhook && (
          <>
            <DetailRow>
              <DetailLabel>Callback</DetailLabel>
              <DetailValue>{webhook.url}</DetailValue>
            </DetailRow>
            {webhookSecret !== undefined && (
              <DetailRow>
                <DetailLabel>Secret</DetailLabel>
                <WebhookSecretField secret={webhookSecret} />
              </DetailRow>
            )}
            {webhook.id !== undefined && (
              <DetailRow>
                <DetailLabel>Webhook id</DetailLabel>
                <DetailValue>{webhook.id}</DetailValue>
              </DetailRow>
            )}
            <DetailRow>
              <DetailLabel>TTL asked</DetailLabel>
              <DetailValue>{formatTtlSuggestion(webhook.ttlMs)}</DetailValue>
            </DetailRow>
            <DetailRow>
              <DetailLabel>Expires</DetailLabel>
              <DetailValue>
                {formatRefreshBefore(webhook.refreshBefore)}
              </DetailValue>
            </DetailRow>
            {live && webhook.nextRefreshAt && (
              <DetailRow>
                <DetailLabel>Next refresh</DetailLabel>
                <DetailValue>{webhook.nextRefreshAt.toISOString()}</DetailValue>
              </DetailRow>
            )}
            <NoteText>
              {webhook.refreshes} successful subscribe
              {webhook.refreshes === 1 ? "" : "s"}
              {webhook.truncated ? " · last response truncated (gap)" : ""}
            </NoteText>
            {webhook.deliveryStatus ? (
              describeDeliveryStatus(webhook.deliveryStatus).map((line) => (
                <NoteText key={line}>{line}</NoteText>
              ))
            ) : (
              <NoteText>
                No delivery status reported (a server includes it on a refresh,
                if at all).
              </NoteText>
            )}
            {webhook.unsubscribe && (
              <NoteText>
                {UNSUBSCRIBE_LABELS[webhook.unsubscribe.status]}
                {webhook.unsubscribe.status === "failed" &&
                  webhook.unsubscribe.error &&
                  `: ${describeEventsError(webhook.unsubscribe.error)}`}
              </NoteText>
            )}
          </>
        )}
        {webhook ? (
          // Deliveries go to the callback, never here, so only what the
          // management loop sees is counted.
          <CountsText>
            {counts.gaps} gaps · {counts.errors} errors · {counts.reconnects}{" "}
            retries
          </CountsText>
        ) : (
          <CountsText>
            {counts.events} events · {counts.gaps} gaps · {counts.errors} errors
            · {counts.reconnects} reconnects · {counts.duplicates} duplicates ·{" "}
            {counts.invalidPayloads} invalid payloads
          </CountsText>
        )}
        {termination ? (
          <ErrorText>
            Terminated ({termination.reason},{" "}
            {RELIST_LABELS[termination.relist]}
            ): {describeError(termination.error)}
          </ErrorText>
        ) : (
          lastError && (
            <ErrorText>Last error: {describeError(lastError)}</ErrorText>
          )
        )}
        <ActionRow>
          {live ? (
            <>
              <StopButton onClick={onStop}>
                {webhook ? "Unsubscribe" : "Stop"}
              </StopButton>
              {webhook && onRefresh && (
                <ActionButton onClick={onRefresh}>Refresh now</ActionButton>
              )}
            </>
          ) : (
            <>
              {canResumeSubscription(subscription) && (
                <ActionButton onClick={onResume}>Resume</ActionButton>
              )}
              {webhook?.unsubscribe?.status === "failed" && (
                <ActionButton onClick={onStop}>Retry unsubscribe</ActionButton>
              )}
              <ActionButton onClick={onRemove}>Remove</ActionButton>
            </>
          )}
          <ActionButton onClick={onToggleLogFilter} aria-pressed={logFiltered}>
            {logFiltered ? "Show all events" : "Filter Log"}
          </ActionButton>
        </ActionRow>
      </CardStack>
    </CardFrame>
  );
}
