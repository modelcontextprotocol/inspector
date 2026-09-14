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
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type { Tool } from "@modelcontextprotocol/client";
import type { ExcludedTool } from "@inspector/core/mcp/types.js";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { ListLoadError } from "../../elements/ListLoadError/ListLoadError";
import { MalformedItemsWarning } from "../../elements/MalformedItemsWarning/MalformedItemsWarning";
import type { MalformedListItem } from "@inspector/core/mcp";
import {
  ListPaginationControls,
  type ListPaginationControlsProps,
} from "../../elements/ListPaginationControls/ListPaginationControls";
import { ToolListItem } from "../ToolListItem/ToolListItem";
import { useScrollMemory } from "../../../hooks/useScrollMemory";
import { toolRowKey } from "../../../utils/toolUtils";

export interface ToolControlsProps {
  tools: Tool[];
  /** Tools the SDK excluded from `tools/list` for invalid `x-mcp-header`
   * annotations (SEP-2243), shown below the list with the reason (#1632). */
  excludedTools?: ExcludedTool[];
  /**
   * The selected row's {@link toolRowKey}, not its name — a `tools/list` may
   * repeat a name, and a name-keyed selection would highlight every copy at
   * once and make the others unclickable (#2001).
   */
  selectedKey?: string;
  // Search text is controlled by the parent (App, via ToolsScreen) so it
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
  /** Emits the clicked row's {@link toolRowKey} (see `selectedKey`). */
  onSelectTool: (key: string) => void;
}

// One excluded tool: a warning icon, the tool name (struck through, since it is
// not callable), and its reason on hover. `wrap: nowrap` keeps the icon pinned.
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

// Fill the full-height `sidebar` Card (a flex column) so the scroll region
// below claims all the remaining space under the fixed title/search — the
// list runs to the bottom of the card before it scrolls, instead of being
// capped short by a fixed max-height. `mih: 0` lets the scroll child shrink
// and scroll rather than overflow the card.
const SidebarStack = Stack.withProps({
  gap: "sm",
  flex: 1,
  mih: 0,
});

// h3 (not h4), size h4: the sampling/elicitation request modals open over this
// screen with an `h2` `Modal.Title`, so an `h4` section would skip a level
// (axe `heading-order`); `size="h4"` keeps the look.
const ToolsTitle = Title.withProps({
  order: 3,
  size: "h4",
});

const SearchInput = TextInput.withProps({
  placeholder: "Search tools...",
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

// Excluded rows render into the same `Stack` as the list rows above them, so
// their keys share one namespace — and an excluded tool's index is counted
// within its own list, which would collide with a listed tool of the same name
// at the same index. The prefix keeps the two spaces apart.
const excludedRowKey = (name: string, sourceIndex: number) =>
  `excluded:${toolRowKey(name, sourceIndex)}`;

/** Matches a tool against the (already lower-cased) search query by name or title. */
const matchesQuery = (tool: Tool, query: string) =>
  tool.name.toLowerCase().includes(query) ||
  (tool.title?.toLowerCase().includes(query) ?? false);

export function ToolControls({
  tools,
  excludedTools = [],
  selectedKey,
  searchText = "",
  listChanged,
  onRefreshList,
  malformedListItems = [],
  loadError,
  pagination,
  onSearchChange,
  onSelectTool,
}: ToolControlsProps) {
  const viewportRef = useScrollMemory("tools-sidebar");
  const query = searchText.toLowerCase();
  // Stamp each row's source position before filtering, so the key survives the
  // list narrowing (#1957).
  const filteredTools = tools
    .map((tool, sourceIndex) => ({
      tool,
      key: toolRowKey(tool.name, sourceIndex),
    }))
    .filter(({ tool }) => !searchText || matchesQuery(tool, query));
  // Excluded tools are searchable too, matching name AND title like the main
  // list above, so a filtered view stays consistent.
  const filteredExcluded = excludedTools
    .map((excluded, sourceIndex) => ({
      ...excluded,
      key: excludedRowKey(excluded.tool.name, sourceIndex),
    }))
    .filter(({ tool }) => !searchText || matchesQuery(tool, query));

  return (
    <SidebarStack>
      <Group justify="space-between">
        <ToolsTitle>Tools</ToolsTitle>
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
      <ListLoadError error={loadError} what="tools" onRetry={onRefreshList} />
      <MalformedItemsWarning
        items={malformedListItems}
        method="tools/list"
        what="tools"
      />
      <SidebarScroll viewportRef={viewportRef}>
        <Stack gap="xs">
          {filteredTools.map(({ tool, key }) => (
            <ToolListItem
              key={key}
              tool={tool}
              selected={key === selectedKey}
              onClick={() => {
                if (key !== selectedKey) onSelectTool(key);
              }}
            />
          ))}
          {filteredExcluded.length > 0 && (
            <>
              <ExcludedDivider />
              {filteredExcluded.map(({ tool, reason, key }) => (
                <ExcludedTooltip key={key} label={reason}>
                  <ExcludedRow>
                    <ExcludedWarningIcon>
                      <RiErrorWarningLine />
                    </ExcludedWarningIcon>
                    <ExcludedName>{tool.name}</ExcludedName>
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
