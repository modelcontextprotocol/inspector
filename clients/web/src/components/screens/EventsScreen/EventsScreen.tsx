import { useState } from "react";
import { Card, Flex, ScrollArea, Stack, Text, Title } from "@mantine/core";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import type { ExcludedEventType } from "@inspector/core/extension/events/headers.js";
import type {
  EventLogEntry,
  EventSubscribeOptions,
  EventSubscription,
  EventSubscriptionMode,
} from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import { EventControls } from "../../groups/EventControls/EventControls";
import { EventDetailPanel } from "../../groups/EventDetailPanel/EventDetailPanel";
import { EventSubscriptionCard } from "../../groups/EventSubscriptionCard/EventSubscriptionCard";
import { EventLogPanel } from "../../groups/EventLogPanel/EventLogPanel";
import type { ListPaginationControlsProps } from "../../elements/ListPaginationControls/ListPaginationControls";
import { collectSchemaDefaults, toFormSchema } from "../../../utils/jsonUtils";
import {
  buildSubscribeOptions,
  findLiveSubscription,
  eventArguments,
  filterEventLog,
  resolveSubscribeMode,
  type SubscribeTuning,
} from "../../../utils/eventsUtils";

/**
 * The Events tab's selection, form and filter state, lifted to App so it
 * survives tab navigation within a session (#1417). The subscriptions and the
 * occurrence log are not here: they live in the core subscription engine.
 */
export interface EventsUiState {
  selectedEventName?: string;
  formValues: Record<string, unknown>;
  search: string;
  /** The last mode picked; resolved against each type's offer on render. */
  mode?: EventSubscriptionMode;
  tuning: SubscribeTuning;
  /** Narrows the occurrence log to one subscription (its registry id). */
  logFilter?: string;
}

export interface EventsScreenProps {
  eventTypes: EventType[];
  excludedEventTypes?: ExcludedEventType[];
  listChanged: boolean;
  loadError?: Error | null;
  pagination: ListPaginationControlsProps;
  subscriptions: EventSubscription[];
  /** The occurrence log, every subscription's, oldest first. */
  log: EventLogEntry[];
  ui: EventsUiState;
  onUiChange: (next: EventsUiState) => void;
  onRefreshList: () => void;
  /**
   * Start a subscription. Throws when the engine refuses it (the connection
   * no longer offers Events, or the type does not advertise the mode); the
   * screen shows the message beside the form.
   */
  onSubscribe: (eventType: EventType, options: EventSubscribeOptions) => void;
  onStopSubscription: (id: string) => void;
  /** Start a stopped or resumable terminated subscription; may throw. */
  onResumeSubscription: (id: string) => void;
  onRemoveSubscription: (id: string) => void;
  onClearLog: () => void;
  /**
   * The signing secret the next webhook subscribe sends. Held by App outside
   * {@link EventsUiState}, which is snapshotted to `sessionStorage` across an
   * OAuth redirect: the secret must never be written anywhere (#3031).
   */
  webhookSecret?: string;
  onRegenerateWebhookSecret?: () => void;
  /** A webhook subscription's secret, for its card's copy control. */
  getWebhookSecret?: (id: string) => string | undefined;
  /** Refresh a live webhook subscription now. */
  onRefreshWebhook?: (id: string) => void;
}

// Each column caps at the screen's height so its card scrolls inside rather
// than pushing the page (ToolsScreen's arrangement).
const SCROLL_MAX_HEIGHT =
  "calc(100dvh - var(--app-shell-header-height, 0px) - var(--app-shell-footer-height, 0px) - var(--mantine-spacing-xl) * 2)";

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100dvh - var(--app-shell-header-height, 0px) - var(--app-shell-footer-height, 0px))",
  gap: "md",
  p: "xl",
});

const Sidebar = Stack.withProps({
  w: 300,
  flex: "0 0 auto",
});

const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  variant: "sidebar",
});

const ContentPane = Flex.withProps({
  flex: 1,
  miw: 0,
  direction: "column",
  align: "stretch",
});

const ContentCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  variant: "preview",
});

// The activity column gets the larger share: its cards hold the most text.
const ActivityPane = Flex.withProps({
  flex: 1.4,
  miw: 0,
  direction: "column",
  align: "stretch",
});

// The right column: subscriptions above, the occurrence log filling the rest.
const ActivityStack = Stack.withProps({
  gap: "md",
  flex: 1,
  mih: 0,
});

const SubscriptionsCard = Card.withProps({
  withBorder: true,
  padding: "md",
  flex: "0 1 auto",
  mah: "45%",
  variant: "preview",
});

const LogCard = Card.withProps({
  withBorder: true,
  padding: "md",
  flex: 1,
  mih: 0,
  variant: "preview",
});

const SubscriptionsStack = Stack.withProps({
  gap: "xs",
  mih: 0,
});

const SubscriptionsScroll = ScrollArea.withProps({
  flex: "0 1 auto",
  mih: 0,
  scrollbars: "y",
});

const SubscriptionsTitle = Title.withProps({
  order: 3,
  size: "h5",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

const EmptySubscriptions = Text.withProps({
  size: "sm",
  c: "dimmed",
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The Events tab (SEP-3415, #3030): the server's event types, a subscribe form
 * for the selected one, the live subscriptions with their state and controls,
 * and the occurrence stream every subscription feeds.
 */
export function EventsScreen({
  eventTypes,
  excludedEventTypes,
  listChanged,
  loadError,
  pagination,
  subscriptions,
  log,
  ui,
  onUiChange,
  onRefreshList,
  onSubscribe,
  onStopSubscription,
  onResumeSubscription,
  onRemoveSubscription,
  onClearLog,
  webhookSecret,
  onRegenerateWebhookSecret,
  getWebhookSecret,
  onRefreshWebhook,
}: EventsScreenProps) {
  const selected = eventTypes.find((e) => e.name === ui.selectedEventName);
  const mode = selected ? resolveSubscribeMode(selected, ui.mode) : undefined;
  // Screen-local: a refusal belongs to the attempt the user is looking at, so
  // it clears on the next selection and on the next attempt.
  const [subscribeError, setSubscribeError] = useState<string>();
  const filtered = subscriptions.find((s) => s.id === ui.logFilter);
  const liveMatch =
    selected && mode
      ? findLiveSubscription(
          subscriptions,
          selected.name,
          mode,
          eventArguments(selected.inputSchema, ui.formValues),
          ui.tuning.callbackUrl,
        )
      : undefined;
  const entries = filterEventLog(log, filtered?.id);

  const handleSelect = (name: string) => {
    const eventType = eventTypes.find((e) => e.name === name);
    /* v8 ignore next -- the sidebar only emits names from this list */
    if (!eventType) return;
    setSubscribeError(undefined);
    onUiChange({
      ...ui,
      selectedEventName: name,
      // Seeded with the schema's defaults so a default-only field is sent
      // without being edited (the Tools tab's rule).
      formValues: collectSchemaDefaults(
        toFormSchema(eventType.inputSchema) ?? {},
      ),
    });
  };

  const handleSubscribe = () => {
    /* v8 ignore next -- Subscribe is disabled without a type and a mode */
    if (!selected || !mode) return;
    setSubscribeError(undefined);
    try {
      onSubscribe(
        selected,
        buildSubscribeOptions(
          mode,
          eventArguments(selected.inputSchema, ui.formValues),
          ui.tuning,
          webhookSecret,
        ),
      );
    } catch (err) {
      setSubscribeError(errorMessage(err));
    }
  };

  const handleResume = (id: string) => {
    try {
      onResumeSubscription(id);
    } catch (err) {
      setSubscribeError(errorMessage(err));
    }
  };

  const handleRemove = (id: string) => {
    onRemoveSubscription(id);
    if (ui.logFilter === id) onUiChange({ ...ui, logFilter: undefined });
  };

  return (
    // `data-*` readiness contract for the headless Events smoke; see
    // clients/web/README.md#core-tab-automation-contract. Passed here because
    // `data-*` attributes are not part of a component's typed props.
    <ScreenLayout
      data-testid="events-screen"
      data-event-count={eventTypes.length}
      data-subscription-count={subscriptions.length}
      data-log-count={log.length}
    >
      <Sidebar>
        <SidebarCard>
          <EventControls
            eventTypes={eventTypes}
            excludedEventTypes={excludedEventTypes}
            selectedName={ui.selectedEventName}
            searchText={ui.search}
            listChanged={listChanged}
            onRefreshList={onRefreshList}
            loadError={loadError}
            pagination={pagination}
            onSearchChange={(search) => onUiChange({ ...ui, search })}
            onSelectEventType={handleSelect}
          />
        </SidebarCard>
      </Sidebar>

      <ContentPane mah={SCROLL_MAX_HEIGHT}>
        {selected ? (
          <ContentCard>
            <EventDetailPanel
              eventType={selected}
              formValues={ui.formValues}
              onFormChange={(formValues) => onUiChange({ ...ui, formValues })}
              mode={mode}
              onModeChange={(next) => onUiChange({ ...ui, mode: next })}
              tuning={ui.tuning}
              onTuningChange={(tuning) => onUiChange({ ...ui, tuning })}
              onSubscribe={handleSubscribe}
              onUnsubscribe={
                liveMatch ? () => onStopSubscription(liveMatch.id) : undefined
              }
              subscribeError={subscribeError}
              webhookSecret={webhookSecret}
              onRegenerateWebhookSecret={onRegenerateWebhookSecret}
            />
          </ContentCard>
        ) : (
          <ContentCard flex={1}>
            <EmptyState>Select an event type to subscribe</EmptyState>
          </ContentCard>
        )}
      </ContentPane>

      <ActivityPane mah={SCROLL_MAX_HEIGHT}>
        <ActivityStack>
          <SubscriptionsCard>
            <SubscriptionsStack>
              <SubscriptionsTitle>
                Subscriptions ({subscriptions.length})
              </SubscriptionsTitle>
              {subscriptions.length === 0 ? (
                <EmptySubscriptions>No subscriptions yet.</EmptySubscriptions>
              ) : (
                <SubscriptionsScroll>
                  <Stack gap="xs">
                    {subscriptions.map((subscription) => (
                      <EventSubscriptionCard
                        key={subscription.id}
                        subscription={subscription}
                        logFiltered={filtered?.id === subscription.id}
                        onStop={() => onStopSubscription(subscription.id)}
                        onResume={() => handleResume(subscription.id)}
                        onRemove={() => handleRemove(subscription.id)}
                        webhookSecret={
                          subscription.mode === "webhook"
                            ? getWebhookSecret?.(subscription.id)
                            : undefined
                        }
                        onRefresh={
                          onRefreshWebhook &&
                          (() => onRefreshWebhook(subscription.id))
                        }
                        onToggleLogFilter={() =>
                          onUiChange({
                            ...ui,
                            logFilter:
                              filtered?.id === subscription.id
                                ? undefined
                                : subscription.id,
                          })
                        }
                      />
                    ))}
                  </Stack>
                </SubscriptionsScroll>
              )}
            </SubscriptionsStack>
          </SubscriptionsCard>
          <LogCard>
            <EventLogPanel
              entries={entries}
              subscriptions={subscriptions}
              filteredTo={
                filtered ? `${filtered.name} (${filtered.mode})` : undefined
              }
              onClear={onClearLog}
            />
          </LogCard>
        </ActivityStack>
      </ActivityPane>
    </ScreenLayout>
  );
}
