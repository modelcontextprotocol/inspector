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
import {
  ListPaginationControls,
  type ListPaginationControlsProps,
} from "../../elements/ListPaginationControls/ListPaginationControls";
import { ToolListItem } from "../ToolListItem/ToolListItem";
import { useScrollMemory } from "../../../hooks/useScrollMemory";

export interface ToolControlsProps {
  tools: Tool[];
  /** Tools the SDK excluded from `tools/list` for invalid `x-mcp-header`
   * annotations (SEP-2243), shown below the list with the reason (#1632). */
  excludedTools?: ExcludedTool[];
  selectedName?: string;
  // Search text is controlled by the parent (App, via ToolsScreen) so it
  // persists across tab navigation within a live session — see #1417.
  searchText?: string;
  listChanged: boolean;
  onRefreshList: () => void;
  /** Pagination controls (#1721). */
  pagination: ListPaginationControlsProps;
  onSearchChange: (value: string) => void;
  onSelectTool: (name: string) => void;
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

export function ToolControls({
  tools,
  excludedTools = [],
  selectedName,
  searchText = "",
  listChanged,
  onRefreshList,
  pagination,
  onSearchChange,
  onSelectTool,
}: ToolControlsProps) {
  const viewportRef = useScrollMemory("tools-sidebar");
  const query = searchText.toLowerCase();
  const filteredTools = searchText
    ? tools.filter(
        (tool) =>
          tool.name.toLowerCase().includes(query) ||
          (tool.title?.toLowerCase().includes(query) ?? false),
      )
    : tools;
  // Excluded tools are searchable too, matching name AND title like the main
  // list above, so a filtered view stays consistent.
  const filteredExcluded = searchText
    ? excludedTools.filter(
        ({ tool }) =>
          tool.name.toLowerCase().includes(query) ||
          (tool.title?.toLowerCase().includes(query) ?? false),
      )
    : excludedTools;

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
      <SidebarScroll viewportRef={viewportRef}>
        <Stack gap="xs">
          {filteredTools.map((tool) => (
            <ToolListItem
              key={tool.name}
              tool={tool}
              selected={tool.name === selectedName}
              onClick={() => {
                if (tool.name !== selectedName) onSelectTool(tool.name);
              }}
            />
          ))}
          {filteredExcluded.length > 0 && (
            <>
              <ExcludedDivider />
              {filteredExcluded.map(({ tool, reason }) => (
                <ExcludedTooltip key={tool.name} label={reason}>
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
