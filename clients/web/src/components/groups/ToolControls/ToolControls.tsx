import { Group, ScrollArea, Stack, TextInput, Title } from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { ToolListItem } from "../ToolListItem/ToolListItem";
import { useScrollMemory } from "../../../hooks/useScrollMemory";

export interface ToolControlsProps {
  tools: Tool[];
  selectedName?: string;
  // Search text is controlled by the parent (App, via ToolsScreen) so it
  // persists across tab navigation within a live session — see #1417.
  searchText?: string;
  listChanged: boolean;
  onRefreshList: () => void;
  onSearchChange: (value: string) => void;
  onSelectTool: (name: string) => void;
}

export function ToolControls({
  tools,
  selectedName,
  searchText = "",
  listChanged,
  onRefreshList,
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
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
