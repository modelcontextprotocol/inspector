import { Button, Group, Paper, Stack, Text } from "@mantine/core";
import type { EventSubscription } from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import { DeliveryModeBadge } from "../../elements/DeliveryModeBadge/DeliveryModeBadge";
import { EventSubscriptionStatusBadge } from "../../elements/EventSubscriptionStatusBadge/EventSubscriptionStatusBadge";
import {
  canResumeSubscription,
  describeEventsError,
  formatCursor,
  formatInterval,
  formatSubscriptionArguments,
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
  variant: "light",
  color: "red",
});

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
}: EventSubscriptionCardProps) {
  const { name, mode, status, cursor, counts, lastError, termination } =
    subscription;
  const interval = subscriptionInterval(subscription);
  const live = isSubscriptionLive(subscription);

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
        <CountsText>
          {counts.events} events · {counts.gaps} gaps · {counts.errors} errors ·{" "}
          {counts.reconnects} reconnects · {counts.duplicates} duplicates ·{" "}
          {counts.invalidPayloads} invalid payloads
        </CountsText>
        {termination ? (
          <ErrorText>
            Terminated ({termination.reason},{" "}
            {RELIST_LABELS[termination.relist]}
            ): {describeEventsError(termination.error)}
          </ErrorText>
        ) : (
          lastError && (
            <ErrorText>Last error: {describeEventsError(lastError)}</ErrorText>
          )
        )}
        <ActionRow>
          {live ? (
            <StopButton onClick={onStop}>Stop</StopButton>
          ) : (
            <>
              {canResumeSubscription(subscription) && (
                <ActionButton onClick={onResume}>Resume</ActionButton>
              )}
              <ActionButton onClick={onRemove}>Remove</ActionButton>
            </>
          )}
          <ActionButton onClick={onToggleLogFilter} aria-pressed={logFiltered}>
            {logFiltered ? "Show all events" : "Only this in log"}
          </ActionButton>
        </ActionRow>
      </CardStack>
    </CardFrame>
  );
}
