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

const LIST_MAX_HEIGHT =
  "calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2 - 160px)";

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
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={4}>Tools</Title>
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
      <ScrollArea.Autosize viewportRef={viewportRef} mah={LIST_MAX_HEIGHT}>
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
      </ScrollArea.Autosize>
    </Stack>
  );
}
