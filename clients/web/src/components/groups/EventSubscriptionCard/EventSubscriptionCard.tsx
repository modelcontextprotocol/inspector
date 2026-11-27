import { Button, Divider, Group, Paper, Stack, Text } from "@mantine/core";
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
  gap: "sm",
});

// Name on the left, mode and state on the right; on a narrow column (the
// monitoring sidebar open beside it) the badges wrap under the name rather
// than squeezing it.
const HeaderRow = Group.withProps({
  justify: "space-between",
  align: "center",
  gap: "xs",
});

const BadgeRow = Group.withProps({
  gap: "xs",
});

const NameText = Text.withProps({
  fw: 600,
  size: "md",
  truncate: "end",
  miw: 0,
});

const SectionDivider = Divider.withProps({
  color: "var(--inspector-border-default)",
});

const DetailStack = Stack.withProps({
  gap: 4,
});

const DetailRow = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
  align: "baseline",
});

const DetailLabel = Text.withProps({
  size: "xs",
  c: "var(--inspector-text-secondary)",
  w: 88,
  flex: "0 0 auto",
});

const DetailValue = Text.withProps({
  size: "xs",
  ff: "monospace",
  truncate: "end",
  miw: 0,
});

// The tallies, one figure per column with its name under it, so a count is
// read at a glance rather than found in a sentence.
const TallyRow = Group.withProps({
  gap: "lg",
  align: "flex-start",
});

const TallyStack = Stack.withProps({
  gap: 0,
});

const TallyFigure = Text.withProps({
  size: "md",
  fw: 600,
  ff: "monospace",
});

const TallyName = Text.withProps({
  size: "xs",
  c: "var(--inspector-text-secondary)",
});

const ErrorText = Text.withProps({
  size: "xs",
  c: "var(--inspector-danger-text)",
});

const ActionRow = Group.withProps({
  justify: "space-between",
  gap: "xs",
});

const ActionGroup = Group.withProps({
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

/** How a nonzero tally reads: a lost or repeated event warns, a failure is an error. */
type TallyTone = "neutral" | "warning" | "danger";

const TONE_COLOR: Record<TallyTone, string> = {
  neutral: "var(--inspector-text-primary)",
  warning: "var(--inspector-warning-text)",
  danger: "var(--inspector-danger-text)",
};

interface TallyProps {
  value: number;
  name: string;
  tone?: TallyTone;
}

/**
 * One tally. A zero reads in the secondary text color so the counts that
 * moved stand out; a nonzero problem count takes its tone's color.
 */
function Tally({ value, name, tone = "neutral" }: TallyProps) {
  return (
    <TallyStack>
      <TallyFigure
        c={value === 0 ? "var(--inspector-text-secondary)" : TONE_COLOR[tone]}
      >
        {value}
      </TallyFigure>
      <TallyName>{name}</TallyName>
    </TallyStack>
  );
}

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
        <HeaderRow>
          <NameText>{name}</NameText>
          <BadgeRow>
            <DeliveryModeBadge mode={mode} />
            <EventSubscriptionStatusBadge status={status} />
          </BadgeRow>
        </HeaderRow>
        <SectionDivider />
        <DetailStack>
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
                  <DetailValue>
                    {webhook.nextRefreshAt.toISOString()}
                  </DetailValue>
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
                  No delivery status reported (a server includes it on a
                  refresh, if at all).
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
        </DetailStack>
        <SectionDivider />
        {webhook ? (
          // Deliveries go to the callback, never here, so only what the
          // management loop sees is counted.
          <TallyRow>
            <Tally value={counts.gaps} name="gaps" tone="warning" />
            <Tally value={counts.errors} name="errors" tone="danger" />
            <Tally value={counts.reconnects} name="retries" tone="warning" />
          </TallyRow>
        ) : (
          <TallyRow>
            <Tally value={counts.events} name="events" />
            <Tally value={counts.gaps} name="gaps" tone="warning" />
            <Tally value={counts.errors} name="errors" tone="danger" />
            <Tally value={counts.reconnects} name="reconnects" tone="warning" />
            <Tally value={counts.duplicates} name="duplicates" tone="warning" />
            <Tally
              value={counts.invalidPayloads}
              name="invalid payloads"
              tone="danger"
            />
          </TallyRow>
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
          <ActionGroup>
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
                  <ActionButton onClick={onStop}>
                    Retry unsubscribe
                  </ActionButton>
                )}
                <ActionButton onClick={onRemove}>Remove</ActionButton>
              </>
            )}
          </ActionGroup>
          <ActionButton onClick={onToggleLogFilter} aria-pressed={logFiltered}>
            {logFiltered ? "Show all events" : "Filter Log"}
          </ActionButton>
        </ActionRow>
      </CardStack>
    </CardFrame>
  );
}
