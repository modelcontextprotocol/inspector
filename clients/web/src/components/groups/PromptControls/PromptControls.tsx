import { Group, ScrollArea, Stack, TextInput, Title } from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type { Prompt } from "@modelcontextprotocol/client";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { ListLoadError } from "../../elements/ListLoadError/ListLoadError";
import { MalformedItemsWarning } from "../../elements/MalformedItemsWarning/MalformedItemsWarning";
import type { MalformedListItem } from "@inspector/core/mcp";
import {
  ListPaginationControls,
  type ListPaginationControlsProps,
} from "../../elements/ListPaginationControls/ListPaginationControls";
import { PromptListItem } from "../PromptListItem/PromptListItem";
import { useScrollMemory } from "../../../hooks/useScrollMemory";
import { formatCountedLabel, listCountOf } from "../../../utils/listCount";

// h2 under the page's visually hidden h1 (#2827), sized as the h4 it was so
// the look is unchanged; sections below it are h3 (axe `heading-order`).
const PanelHeading = Title.withProps({ order: 2, size: "h4" });

// Fill the full-height `sidebar` Card (a flex column) so the list runs to the
// bottom of the card before it scrolls, instead of being capped short by a
// fixed max-height. `mih: 0` lets the scroll child shrink and scroll.
const SidebarStack = Stack.withProps({
  gap: "sm",
  flex: 1,
  mih: 0,
});

const SearchInput = TextInput.withProps({
  placeholder: "Search prompts...",
  rightSectionPointerEvents: "auto",
});

const ListScroll = ScrollArea.withProps({
  flex: 1,
  mih: 0,
});

export interface PromptControlsProps {
  prompts: Prompt[];
  selectedName?: string;
  // Search text is controlled by the parent (App, via PromptsScreen) so it
  // persists across tab navigation within a live session — see #1417.
  searchText?: string;
  listChanged: boolean;
  onRefreshList: () => void;
  /**
   * A failed list load, surfaced above the list instead of leaving the panel
   * empty (which reads as "this server has none") (#1953).
   */
  /**
   * Entries the client dropped from this list because they failed the MCP
   * schema. Rendered as a warning above the list, which still shows the rest
   * (#1909).
   */
  malformedListItems?: MalformedListItem[];
  loadError?: Error | null;
  /** Pagination controls (#1721). */
  pagination: ListPaginationControlsProps;
  onSearchChange: (value: string) => void;
  onSelectPrompt: (name: string) => void;
}

export function PromptControls({
  prompts,
  selectedName,
  searchText = "",
  listChanged,
  onRefreshList,
  malformedListItems = [],
  loadError,
  pagination,
  onSearchChange,
  onSelectPrompt,
}: PromptControlsProps) {
  const viewportRef = useScrollMemory("prompts-sidebar");
  const query = searchText.toLowerCase();
  const filteredPrompts = prompts.filter(
    (p) =>
      p.name.toLowerCase().includes(query) ||
      (p.title?.toLowerCase().includes(query) ?? false) ||
      (p.description?.toLowerCase().includes(query) ?? false),
  );

  // The server's total, not the search-filtered view (#2607); omitted until the
  // first load completes and after a failed one, where "(0)" would read as an
  // empty server.
  const title = formatCountedLabel(
    "Prompts",
    listCountOf({
      items: prompts,
      canLoadMore: pagination.canLoadMore,
      error: loadError ?? null,
      loaded: pagination.loaded ?? true,
    }),
  );

  return (
    <SidebarStack>
      <Group justify="space-between">
        <PanelHeading>{title}</PanelHeading>
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
      <ListLoadError error={loadError} what="prompts" onRetry={onRefreshList} />
      <MalformedItemsWarning
        items={malformedListItems}
        method="prompts/list"
        what="prompts"
      />
      <ListScroll viewportRef={viewportRef}>
        <Stack gap="xs">
          {filteredPrompts.map((prompt) => (
            <PromptListItem
              key={prompt.name}
              prompt={prompt}
              selected={prompt.name === selectedName}
              onClick={() => {
                if (prompt.name !== selectedName) onSelectPrompt(prompt.name);
              }}
            />
          ))}
        </Stack>
      </ListScroll>
    </SidebarStack>
  );
}
