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
    // Fill the full-height `sidebar` Card (a flex column) so the scroll region
    // below claims all the remaining space under the fixed title/search — the
    // list runs to the bottom of the card before it scrolls, instead of being
    // capped short by a fixed max-height. `mih: 0` lets the scroll child shrink
    // and scroll rather than overflow the card.
    <Stack gap="sm" flex={1} mih={0}>
      <Group justify="space-between">
        {/* h3 (not h4), size h4: the sampling/elicitation request modals open
            over this screen with an `h2` `Modal.Title`, so an `h4` section would
            skip a level (axe `heading-order`); `size="h4"` keeps the look. */}
        <Title order={3} size="h4">
          Tools
        </Title>
        <ListChangedIndicator visible={listChanged} onRefresh={onRefreshList} />
      </Group>
      <TextInput
        placeholder="Search tools..."
        value={searchText}
        onChange={(e) => onSearchChange(e.currentTarget.value)}
        rightSectionPointerEvents="auto"
        rightSection={
          searchText ? <ClearButton onClick={() => onSearchChange("")} /> : null
        }
      />
      <ListPaginationControls {...pagination} />
      <ScrollArea viewportRef={viewportRef} flex={1} mih={0}>
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
              <Divider
                label="Excluded (SEP-2243)"
                labelPosition="left"
                mt="sm"
              />
              {filteredExcluded.map(({ tool, reason }) => (
                <Tooltip
                  key={tool.name}
                  label={reason}
                  multiline
                  w={280}
                  withArrow
                  position="right"
                >
                  <ExcludedRow>
                    <ExcludedWarningIcon>
                      <RiErrorWarningLine />
                    </ExcludedWarningIcon>
                    <ExcludedName>{tool.name}</ExcludedName>
                  </ExcludedRow>
                </Tooltip>
              ))}
            </>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
