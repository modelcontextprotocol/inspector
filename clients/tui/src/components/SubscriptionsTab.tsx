/**
 * Subscriptions tab (#2432): subscribe to and unsubscribe from resources, and
 * watch the `notifications/resources/updated` feed they produce.
 *
 * Everything stateful is core's: the subscribed set and each one's
 * `lastUpdated` come from `ResourceSubscriptionsState` (through
 * `useResourceSubscriptions` in `App`), the toggle is one
 * `subscribeToResource` / `unsubscribeFromResource` call — which picks the
 * legacy `resources/subscribe` or the modern `subscriptions/listen` filter by
 * era — and the feed is read from the protocol message log. The tab owns only
 * its selection and the last error.
 *
 * Its own keys avoid every tab accelerator and the global `c`/`d`, since App's
 * handler sees each keypress too: Enter toggles, arrows navigate or scroll.
 */
import React, { useState, useEffect, useRef, useMemo } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type { Resource } from "@modelcontextprotocol/client";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type {
  InspectorResourceSubscription,
  MessageEntry,
  ResourceSubscriptionStreamState,
} from "@inspector/core/mcp/types.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import { useSelectableList } from "../hooks/useSelectableList.js";
import {
  resourceUpdateFeed,
  subscribableResources,
} from "../utils/resourceUpdates.js";

/** How each modern-era listen-stream status reads in the details pane. */
const STREAM_STATUS_TEXT: Record<
  ResourceSubscriptionStreamState["status"],
  { text: string; color: string }
> = {
  connecting: { text: "connecting…", color: "yellow" },
  acknowledged: { text: "acknowledged", color: "green" },
  reconnecting: { text: "reconnecting…", color: "yellow" },
  ended: { text: "ended", color: "gray" },
  "never-acknowledged": {
    text: "closed without acknowledging (server answered listen with a result)",
    color: "red",
  },
};

interface SubscriptionsTabProps {
  resources: Resource[];
  subscriptions: InspectorResourceSubscription[];
  streamState: ResourceSubscriptionStreamState;
  messages: MessageEntry[];
  inspectorClient: InspectorClient | null;
  width: number;
  height: number;
  focusedPane?: "list" | "details" | null;
  modalOpen?: boolean;
  onAuthRecoveryRequired?: (error: AuthRecoveryRequiredError) => void;
}

export function SubscriptionsTab({
  resources,
  subscriptions,
  streamState,
  messages,
  inspectorClient,
  width,
  height,
  focusedPane = null,
  modalOpen = false,
  onAuthRecoveryRequired,
}: SubscriptionsTabProps) {
  const rows = useMemo(
    () => subscribableResources(resources, subscriptions),
    [resources, subscriptions],
  );
  const feed = useMemo(() => resourceUpdateFeed(messages), [messages]);
  const visibleCount = Math.max(1, height - 7);
  const { selectedIndex, firstVisible, setSelection } = useSelectableList(
    rows.length,
    visibleCount,
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollViewRef>(null);
  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;
  const selected = rows[selectedIndex] ?? null;

  const toggle = async (row: (typeof rows)[number]) => {
    if (!inspectorClient) return;
    const { uri } = row.resource;
    setPendingUri(uri);
    setError(null);
    try {
      if (row.subscribed) {
        await inspectorClient.unsubscribeFromResource(uri);
      } else {
        await inspectorClient.subscribeToResource(uri);
      }
    } catch (err) {
      if (err instanceof AuthRecoveryRequiredError) {
        onAuthRecoveryRequired?.(err);
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingUri(null);
    }
  };

  useInput(
    (_input: string, key: Key) => {
      if (key.return && selected && pendingUri === null) {
        // `toggle` owns every rejection (its catch surfaces the message), and
        // a key handler cannot await.
        void toggle(selected);
        return;
      }

      if (focusedPane === "list") {
        if (key.upArrow && selectedIndex > 0) {
          setSelection(selectedIndex - 1);
        } else if (key.downArrow && selectedIndex < rows.length - 1) {
          setSelection(selectedIndex + 1);
        }
        return;
      }

      // Only "details" remains: the hook is inactive for any other pane.
      if (key.upArrow) {
        scrollViewRef.current?.scrollBy(-1);
      } else if (key.downArrow) {
        scrollViewRef.current?.scrollBy(1);
      } else if (key.pageUp) {
        const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
        scrollViewRef.current?.scrollBy(-viewportHeight);
      } else if (key.pageDown) {
        const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
        scrollViewRef.current?.scrollBy(viewportHeight);
      }
    },
    {
      isActive:
        !modalOpen && (focusedPane === "list" || focusedPane === "details"),
    },
  );

  useEffect(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);

  const streamText = STREAM_STATUS_TEXT[streamState.status];
  // On the modern era a server may honor only part of the filter; say so for
  // the selected URI once the stream has been acknowledged.
  const notHonored =
    !!selected &&
    selected.subscribed &&
    streamState.active &&
    streamState.status === "acknowledged" &&
    !streamState.honoredUris.includes(selected.resource.uri);

  return (
    <Box flexDirection="row" width={width} height={height}>
      {/* Resource list with subscription markers */}
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
            Subscriptions ({subscriptions.length}/{rows.length})
          </Text>
        </Box>
        {rows.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No resources to subscribe to</Text>
          </Box>
        ) : (
          <Box
            flexDirection="column"
            height={visibleCount}
            overflow="hidden"
            flexShrink={0}
          >
            {rows
              .slice(firstVisible, firstVisible + visibleCount)
              .map((row, i) => {
                const index = firstVisible + i;
                const isSelected = index === selectedIndex;
                return (
                  <Box key={row.resource.uri} paddingY={0} flexShrink={0}>
                    <Text wrap="truncate">
                      {isSelected ? "▶ " : "  "}
                      <Text color={row.subscribed ? "green" : "gray"}>
                        {row.subscribed ? "●" : "○"}
                      </Text>{" "}
                      {row.resource.name || row.resource.uri}
                    </Text>
                  </Box>
                );
              })}
          </Box>
        )}
      </Box>

      {/* Selected resource + live update feed */}
      <Box
        width={detailWidth}
        height={height}
        paddingX={1}
        flexDirection="column"
        overflow="hidden"
      >
        <Box flexShrink={0} paddingTop={1}>
          <Text
            bold
            wrap="truncate"
            backgroundColor={focusedPane === "details" ? "yellow" : undefined}
            {...(focusedPane === "details" ? {} : { color: "cyan" })}
          >
            {selected
              ? selected.resource.name || selected.resource.uri
              : "Resource updates"}
          </Text>
        </Box>

        <ScrollView ref={scrollViewRef} height={height - 5}>
          {selected && (
            <>
              <Box marginTop={1} flexShrink={0}>
                <Text dimColor wrap="truncate">
                  URI: {selected.resource.uri}
                </Text>
              </Box>
              <Box flexShrink={0}>
                <Text>
                  {pendingUri === selected.resource.uri ? (
                    <Text color="yellow">Updating subscription…</Text>
                  ) : selected.subscribed ? (
                    <Text color="green">Subscribed</Text>
                  ) : (
                    <Text dimColor>Not subscribed</Text>
                  )}
                  {selected.lastUpdated && (
                    <Text dimColor>
                      {" "}
                      — last updated {selected.lastUpdated.toLocaleTimeString()}
                    </Text>
                  )}
                </Text>
              </Box>
              {notHonored && (
                <Box flexShrink={0}>
                  <Text color="yellow">
                    Server did not honor this URI in its listen filter
                  </Text>
                </Box>
              )}
            </>
          )}
          {streamState.active && (
            <Box flexShrink={0}>
              <Text>
                Listen stream:{" "}
                <Text color={streamText.color}>{streamText.text}</Text>
              </Text>
            </Box>
          )}
          {error && (
            <Box marginTop={1} flexShrink={0}>
              <Text color="red">{error}</Text>
            </Box>
          )}
          <Box marginTop={1} flexShrink={0}>
            <Text bold>Updates ({feed.length}):</Text>
          </Box>
          {feed.length === 0 ? (
            <Box paddingLeft={2} flexShrink={0}>
              <Text dimColor>No resources/updated notifications yet</Text>
            </Box>
          ) : (
            feed.map((event) => (
              <Box key={event.id} paddingLeft={2} flexShrink={0}>
                <Text
                  wrap="truncate"
                  {...(selected && event.uri === selected.resource.uri
                    ? { color: "cyan" }
                    : { dimColor: true })}
                >
                  {event.timestamp.toLocaleTimeString()} {event.uri}
                </Text>
              </Box>
            ))
          )}
        </ScrollView>

        {selected && (
          <Box
            flexShrink={0}
            height={1}
            justifyContent="center"
            backgroundColor="gray"
          >
            <Text bold color="white" wrap="truncate">
              {selected.subscribed
                ? "Enter to unsubscribe, ↑/↓ to navigate"
                : "Enter to subscribe, ↑/↓ to navigate"}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
