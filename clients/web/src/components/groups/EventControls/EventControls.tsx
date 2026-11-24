import {
  Divider,
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { RiErrorWarningLine } from "react-icons/ri";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import type { ExcludedEventType } from "@inspector/core/extension/events/headers.js";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { ListLoadError } from "../../elements/ListLoadError/ListLoadError";
import {
  ListPaginationControls,
  type ListPaginationControlsProps,
} from "../../elements/ListPaginationControls/ListPaginationControls";
import { EventTypeListItem } from "../EventTypeListItem/EventTypeListItem";
import { useScrollMemory } from "../../../hooks/useScrollMemory";
import { filterEventTypes } from "../../../utils/eventsUtils";
import { formatCountedLabel, listCountOf } from "../../../utils/listCount";

export interface EventControlsProps {
  eventTypes: EventType[];
  /**
   * Event types the client left out of `events/list` for invalid
   * `x-mcp-header` annotations, shown below the list with the reason — the
   * Tools sidebar's treatment of excluded tools (#1632).
   */
  excludedEventTypes?: ExcludedEventType[];
  selectedName?: string;
  /** Controlled by the parent so it survives tab navigation (#1417). */
  searchText?: string;
  /** A `notifications/events/list_changed` arrived since the last refresh. */
  listChanged: boolean;
  onRefreshList: () => void;
  /** The last list load's failure, shown above the list (#1953). */
  loadError?: Error | null;
  pagination: ListPaginationControlsProps;
  onSearchChange: (value: string) => void;
  onSelectEventType: (name: string) => void;
}

// Fills the full-height `sidebar` Card so the list runs to the card's bottom
// before it scrolls; `mih: 0` lets the scroll child shrink (see ToolControls).
const SidebarStack = Stack.withProps({
  gap: "sm",
  flex: 1,
  mih: 0,
});

// h2 sized as h4: a panel heading under the page's hidden h1 (#2827).
const EventsTitle = Title.withProps({
  order: 2,
  size: "h4",
});

const SearchInput = TextInput.withProps({
  placeholder: "Search events...",
  rightSectionPointerEvents: "auto",
});

const SidebarScroll = ScrollArea.withProps({
  flex: 1,
  mih: 0,
});

const ExcludedDivider = Divider.withProps({
  label: "Excluded (SEP-2243)",
  labelPosition: "left",
  mt: "sm",
});

const ExcludedTooltip = Tooltip.withProps({
  multiline: true,
  w: 280,
  withArrow: true,
  position: "right",
});

const ExcludedRow = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
  align: "center",
});

const ExcludedWarningIcon = ThemeIcon.withProps({
  size: "sm",
  variant: "transparent",
  c: "var(--inspector-log-warning)",
  "aria-hidden": true,
});

const ExcludedName = Text.withProps({
  size: "sm",
  td: "line-through",
  c: "var(--inspector-text-secondary)",
  truncate: "end",
});

/**
 * The Events sidebar (SEP-3415, #3030): the server's event types with their
 * delivery modes, a search, the list-changed indicator, pagination, and the
 * types excluded for invalid header annotations.
 */
export function EventControls({
  eventTypes,
  excludedEventTypes = [],
  selectedName,
  searchText = "",
  listChanged,
  onRefreshList,
  loadError,
  pagination,
  onSearchChange,
  onSelectEventType,
}: EventControlsProps) {
  const viewportRef = useScrollMemory("events-sidebar");
  const visible = filterEventTypes(eventTypes, searchText);
  const excludedTypes = filterEventTypes(
    excludedEventTypes.map((excluded) => excluded.eventType),
    searchText,
  );
  const reasonOf = new Map(
    excludedEventTypes.map((excluded) => [
      excluded.eventType.name,
      excluded.reason,
    ]),
  );
  // The server's total, not the filtered view, withheld until a first load
  // (#2607) — "(0)" before then would read as an empty server.
  const title = formatCountedLabel(
    "Events",
    listCountOf({
      items: eventTypes,
      canLoadMore: pagination.canLoadMore,
      error: loadError ?? null,
      loaded: pagination.loaded ?? true,
    }),
  );

  return (
    <SidebarStack>
      <Group justify="space-between">
        <EventsTitle>{title}</EventsTitle>
        <ListChangedIndicator visible={listChanged} onRefresh={onRefreshList} />
      </Group>
      <SearchInput
        value={searchText}
        onChange={(e) => onSearchChange(e.currentTarget.value)}
        rightSection={
          searchText ? <ClearButton onClick={() => onSearchChange("")} /> : null
        }
      />
      <ListPaginationControls {...pagination} />
      <ListLoadError error={loadError} what="events" onRetry={onRefreshList} />
      <SidebarScroll viewportRef={viewportRef}>
        <Stack gap="xs">
          {visible.map((eventType) => (
            <EventTypeListItem
              key={eventType.name}
              eventType={eventType}
              selected={eventType.name === selectedName}
              onClick={() => {
                if (eventType.name !== selectedName) {
                  onSelectEventType(eventType.name);
                }
              }}
            />
          ))}
          {excludedTypes.length > 0 && (
            <>
              <ExcludedDivider />
              {excludedTypes.map((eventType) => (
                <ExcludedTooltip
                  key={`excluded:${eventType.name}`}
                  label={reasonOf.get(eventType.name)}
                >
                  <ExcludedRow>
                    <ExcludedWarningIcon>
                      <RiErrorWarningLine />
                    </ExcludedWarningIcon>
                    <ExcludedName>{eventType.name}</ExcludedName>
                  </ExcludedRow>
                </ExcludedTooltip>
              ))}
            </>
          )}
        </Stack>
      </SidebarScroll>
    </SidebarStack>
  );
}
