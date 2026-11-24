import {
  Badge,
  Button,
  Code,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import type {
  EventLogEntry,
  EventSubscription,
} from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import {
  describeEventsError,
  formatCursor,
  formatPayload,
} from "../../../utils/eventsUtils";

export interface EventLogPanelProps {
  /** The entries to show, oldest first (the store's order). */
  entries: EventLogEntry[];
  /** Every subscription, to name each entry's and find its payload schema. */
  subscriptions: EventSubscription[];
  /** Set when the log is narrowed to one subscription, to say so. */
  filteredTo?: string;
  onClear: () => void;
}

const PanelStack = Stack.withProps({
  gap: "sm",
  flex: 1,
  mih: 0,
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
});

// h3 under the screen's h2 panel headings.
const PanelTitle = Title.withProps({
  order: 3,
  size: "h5",
});

const ClearLogButton = Button.withProps({
  size: "compact-xs",
  variant: "subtle",
});

// `tabIndex: 0` on the viewport: a log of payloads may hold nothing focusable,
// and axe's `scrollable-region-focusable` requires a scroll region to be
// reachable from the keyboard (the EmbeddableScrollArea treatment).
const LogScroll = ScrollArea.withProps({
  flex: 1,
  mih: 0,
  viewportProps: { tabIndex: 0 },
});

const EntryFrame = Paper.withProps({
  withBorder: true,
  p: "xs",
  radius: "sm",
});

const EntryStack = Stack.withProps({
  gap: 4,
});

const EntryHeader = Group.withProps({
  gap: "xs",
  wrap: "wrap",
});

const KindBadge = Badge.withProps({
  variant: "filled",
  autoContrast: true,
  size: "sm",
  tt: "none",
});

const ValidationBadge = Badge.withProps({
  variant: "light",
  size: "sm",
  tt: "none",
});

const PayloadErrorTooltip = Tooltip.withProps({
  multiline: true,
  w: 280,
  withArrow: true,
});

const EntryMeta = Text.withProps({
  size: "xs",
  c: "var(--inspector-text-secondary)",
});

const EntryText = Text.withProps({
  size: "xs",
});

// Payloads are untrusted (spec, Security): rendered as a text node in a code
// block, never as Markdown or HTML.
// `wrapping` so a long value wraps instead of opening a horizontal scroll
// region of its own.
const PayloadBlock = Code.withProps({
  block: true,
  variant: "wrapping",
});

const EmptyText = Text.withProps({
  size: "sm",
  c: "dimmed",
  ta: "center",
  py: "md",
});

const KIND_COLORS: Record<EventLogEntry["kind"], string> = {
  event: "blue",
  gap: "yellow.5",
  error: "red",
  reconnect: "orange.5",
  terminated: "red",
};

function EntryBody({
  entry,
  subscription,
}: {
  entry: EventLogEntry;
  subscription: EventSubscription | undefined;
}) {
  switch (entry.kind) {
    case "event":
      return (
        <>
          <EntryMeta>
            {entry.occurrence.timestamp} · eventId {entry.occurrence.eventId}
            {entry.occurrence.cursor != null &&
              ` · cursor ${entry.occurrence.cursor}`}
          </EntryMeta>
          <PayloadBlock>{formatPayload(entry.occurrence.data)}</PayloadBlock>
        </>
      );
    case "gap":
      return (
        <EntryText>
          Events may have been missed (the server truncated the replay).
          Resuming from cursor {formatCursor(entry.cursor)}.
        </EntryText>
      );
    case "error":
      return <EntryText>{describeEventsError(entry.error)}</EntryText>;
    case "reconnect":
      return <EntryText>Reconnecting: {entry.reason}</EntryText>;
    case "terminated":
      return (
        <EntryText>
          {entry.reason}: {describeEventsError(entry.error)}
          {subscription?.termination?.canResubscribe &&
            " — the event type is still listed; Resume is offered."}
        </EntryText>
      );
  }
}

/**
 * The verdict the engine recorded when the occurrence arrived — not one
 * re-derived from the subscription's current descriptor, which a re-list can
 * replace after the fact.
 */
function ValidationFlag({ entry }: { entry: EventLogEntry }) {
  if (entry.kind !== "event") return null;
  switch (entry.payload) {
    case "invalid":
      return (
        <PayloadErrorTooltip label={entry.payloadError}>
          <ValidationBadge color="red">payload invalid</ValidationBadge>
        </PayloadErrorTooltip>
      );
    case "valid":
      return <ValidationBadge color="green">payload valid</ValidationBadge>;
    case "unchecked":
      return (
        <ValidationBadge color="gray">payload not checked</ValidationBadge>
      );
  }
}

/**
 * The Events occurrence stream (SEP-3415, #3030), newest first: each
 * occurrence with its `data` as inert JSON and a payload-schema validation
 * badge, interleaved with the gap, error, reconnect and termination markers
 * the subscription engine logs, so every outcome is visible.
 */
export function EventLogPanel({
  entries,
  subscriptions,
  filteredTo,
  onClear,
}: EventLogPanelProps) {
  const byId = new Map(subscriptions.map((s) => [s.id, s]));
  const newestFirst = [...entries].reverse();

  return (
    <PanelStack data-testid="event-log" data-entry-count={entries.length}>
      <HeaderRow>
        <PanelTitle>
          Occurrences{filteredTo ? ` — ${filteredTo}` : ""} ({entries.length})
        </PanelTitle>
        <ClearLogButton onClick={onClear} disabled={entries.length === 0}>
          Clear
        </ClearLogButton>
      </HeaderRow>
      <LogScroll>
        {newestFirst.length === 0 ? (
          <EmptyText>No occurrences yet.</EmptyText>
        ) : (
          <Stack gap="xs">
            {newestFirst.map((entry) => {
              const subscription = byId.get(entry.subscription);
              return (
                <EntryFrame
                  key={entry.seq}
                  data-testid="event-log-entry"
                  data-kind={entry.kind}
                >
                  <EntryStack>
                    <EntryHeader>
                      <KindBadge color={KIND_COLORS[entry.kind]}>
                        {entry.kind}
                      </KindBadge>
                      <EntryMeta>
                        {subscription
                          ? `${subscription.name} (${subscription.mode})`
                          : entry.subscription}{" "}
                        · {entry.at.toLocaleTimeString()}
                      </EntryMeta>
                      <ValidationFlag entry={entry} />
                    </EntryHeader>
                    <EntryBody entry={entry} subscription={subscription} />
                  </EntryStack>
                </EntryFrame>
              );
            })}
          </Stack>
        )}
      </LogScroll>
    </PanelStack>
  );
}
