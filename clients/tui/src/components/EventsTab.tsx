/**
 * Events tab (#3032): the TUI's view of the Events extension (SEP-3415) — the
 * server's event types, the poll and push subscriptions started from here, and
 * their occurrence log.
 *
 * Deliberately thin, like the Tasks tab: the event-type list is core's
 * `ManagedEventsState` and every subscription runs on core's
 * `EventSubscriptionsState` (both held by `App`), so cursors, `nextPollMs`,
 * heartbeats, reconnects, dedup and termination are decided there, not here.
 * This file selects, renders, and forwards three keys.
 *
 * Keys avoid every tab accelerator and the global `c`/`d`, since App's handler
 * sees each keypress too: Enter subscribe (opens the dialog), `x` stop the
 * selected type's live subscriptions, `l` clear the occurrence log.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import type {
  EventLogEntry,
  EventSubscription,
} from "@inspector/core/mcp/state/index.js";
import { useSelectableList } from "../hooks/useSelectableList.js";
import {
  eventLogLine,
  isLiveSubscription,
  subscriptionStatusColor,
  subscriptionSummary,
  terminationText,
} from "../utils/eventsDisplay.js";
import { errorMessage } from "../utils/errorText.js";

interface EventsTabProps {
  eventTypes: EventType[];
  subscriptions: EventSubscription[];
  log: EventLogEntry[];
  /** The last `events/list` walk's failure, if it failed. */
  loadError?: Error | null;
  width: number;
  height: number;
  focusedPane?: "list" | "details" | null;
  modalOpen?: boolean;
  /** Open the subscribe dialog for this event type. */
  onSubscribe: (eventType: EventType) => void;
  /** Stop these subscriptions (they stay listed, as stopped). */
  onStop: (subscriptionIds: string[]) => void;
  onClearLog: () => void;
}

export function EventsTab({
  eventTypes,
  subscriptions,
  log,
  loadError = null,
  width,
  height,
  focusedPane = null,
  modalOpen = false,
  onSubscribe,
  onStop,
  onClearLog,
}: EventsTabProps) {
  const visibleCount = Math.max(1, height - 7);
  const { selectedIndex, firstVisible, setSelection } = useSelectableList(
    eventTypes.length,
    visibleCount,
    { resetWhen: eventTypes },
  );
  const scrollViewRef = useRef<ScrollViewRef>(null);
  const listWidth = Math.floor(width * 0.35);
  const detailWidth = width - listWidth;

  const selected = eventTypes[selectedIndex] ?? null;
  const selectedSubscriptions = useMemo(
    () =>
      selected
        ? subscriptions.filter((s) => s.name === selected.name)
        : ([] as EventSubscription[]),
    [selected, subscriptions],
  );
  const selectedLog = useMemo(() => {
    const ids = new Set(selectedSubscriptions.map((s) => s.id));
    return log.filter((entry) => ids.has(entry.subscription));
  }, [log, selectedSubscriptions]);
  const liveNames = useMemo(
    () => new Set(subscriptions.filter(isLiveSubscription).map((s) => s.name)),
    [subscriptions],
  );

  useInput(
    (input: string, key: Key) => {
      if (key.return && selected) {
        onSubscribe(selected);
        return;
      }
      if (input === "x" && selected) {
        const live = selectedSubscriptions.filter(isLiveSubscription);
        if (live.length > 0) onStop(live.map((s) => s.id));
        return;
      }
      if (input === "l") {
        onClearLog();
        return;
      }
      if (focusedPane === "list") {
        if (key.upArrow && selectedIndex > 0) {
          setSelection(selectedIndex - 1);
        } else if (key.downArrow && selectedIndex < eventTypes.length - 1) {
          setSelection(selectedIndex + 1);
        }
        return;
      }
      const viewport = scrollViewRef.current?.getViewportHeight() || 1;
      if (key.upArrow) scrollViewRef.current?.scrollBy(-1);
      else if (key.downArrow) scrollViewRef.current?.scrollBy(1);
      else if (key.pageUp) scrollViewRef.current?.scrollBy(-viewport);
      else if (key.pageDown) scrollViewRef.current?.scrollBy(viewport);
    },
    {
      isActive:
        !modalOpen && (focusedPane === "list" || focusedPane === "details"),
    },
  );

  // A different event type is a different document: start it at the top.
  useEffect(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);

  return (
    <Box flexDirection="row" width={width} height={height}>
      <Box
        width={listWidth}
        height={height}
        borderStyle="single"
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        borderRight={true}
        flexDirection="column"
        paddingX={1}
      >
        <Box paddingY={1}>
          <Text
            bold
            backgroundColor={focusedPane === "list" ? "yellow" : undefined}
          >
            Event types ({eventTypes.length})
          </Text>
        </Box>
        {loadError ? (
          <Box paddingY={1}>
            <Text color="red">{errorMessage(loadError)}</Text>
          </Box>
        ) : eventTypes.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No event types available</Text>
          </Box>
        ) : (
          <Box
            flexDirection="column"
            height={visibleCount}
            overflow="hidden"
            flexShrink={0}
          >
            {eventTypes
              .slice(firstVisible, firstVisible + visibleCount)
              .map((eventType, i) => {
                const index = firstVisible + i;
                return (
                  <Box key={`${index}:${eventType.name}`} flexShrink={0}>
                    <Text wrap="truncate-end">
                      {index === selectedIndex ? "▶ " : "  "}
                      {eventType.name}
                    </Text>
                    {liveNames.has(eventType.name) && (
                      <Box flexShrink={0}>
                        <Text color="green"> ●</Text>
                      </Box>
                    )}
                  </Box>
                );
              })}
          </Box>
        )}
      </Box>

      <Box
        width={detailWidth}
        height={height}
        paddingX={1}
        flexDirection="column"
        overflow="hidden"
      >
        {selected ? (
          <>
            <Box
              flexShrink={0}
              flexDirection="row"
              flexWrap="wrap"
              justifyContent="space-between"
              columnGap={1}
              paddingTop={1}
            >
              <Text
                bold
                backgroundColor={
                  focusedPane === "details" ? "yellow" : undefined
                }
                {...(focusedPane === "details" ? {} : { color: "cyan" })}
              >
                {selected.name}
              </Text>
              <Box flexShrink={0}>
                <Text color="cyan" bold>
                  [Enter subscribe · x stop · l clear log]
                </Text>
              </Box>
            </Box>
            <ScrollView ref={scrollViewRef} height={height - 3}>
              {selected.description && (
                <Box marginTop={1} flexShrink={0}>
                  <Text dimColor>{selected.description}</Text>
                </Box>
              )}
              <Box flexShrink={0}>
                <Text dimColor>Delivery: {selected.delivery.join(", ")}</Text>
              </Box>

              <Box marginTop={1} flexShrink={0}>
                <Text bold>
                  Subscriptions ({selectedSubscriptions.length}):
                </Text>
              </Box>
              {selectedSubscriptions.length === 0 ? (
                <Box paddingLeft={2} flexShrink={0}>
                  <Text dimColor>None — press Enter to subscribe</Text>
                </Box>
              ) : (
                selectedSubscriptions.map((subscription) => {
                  const ended = terminationText(subscription);
                  return (
                    <Box
                      key={subscription.id}
                      flexDirection="column"
                      paddingLeft={2}
                      flexShrink={0}
                    >
                      <Text
                        color={subscriptionStatusColor(subscription.status)}
                      >
                        {subscriptionSummary(subscription)}
                      </Text>
                      {ended && <Text color="red">{ended}</Text>}
                    </Box>
                  );
                })
              )}

              <Box marginTop={1} flexShrink={0}>
                <Text bold>Occurrences ({selectedLog.length}):</Text>
              </Box>
              {selectedLog.length === 0 ? (
                <Box paddingLeft={2} flexShrink={0}>
                  <Text dimColor>Nothing delivered yet</Text>
                </Box>
              ) : (
                selectedLog.map((entry) => {
                  const line = eventLogLine(entry);
                  return (
                    <Box key={entry.seq} paddingLeft={2} flexShrink={0}>
                      <Text
                        {...(line.color ? { color: line.color } : {})}
                        wrap="truncate-end"
                      >
                        {line.text}
                      </Text>
                    </Box>
                  );
                })
              )}

              <Box marginTop={1} flexShrink={0}>
                <Text bold>Input Schema:</Text>
              </Box>
              {JSON.stringify(selected.inputSchema, null, 2)
                .split("\n")
                .map((line, idx) => (
                  <Box key={`schema-${idx}`} paddingLeft={2} flexShrink={0}>
                    <Text dimColor>{line}</Text>
                  </Box>
                ))}
            </ScrollView>
          </>
        ) : (
          <Box paddingY={1} flexShrink={0}>
            <Text dimColor>Select an event type to view details</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
