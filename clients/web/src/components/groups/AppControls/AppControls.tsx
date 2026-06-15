import {
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { AppListItem } from "../AppListItem/AppListItem";
import { useScrollMemory } from "../../../hooks/useScrollMemory";

export interface AppControlsProps {
  tools: Tool[];
  selectedName?: string;
  // Search text is controlled by the parent (App, via AppsScreen) so it
  // persists across tab navigation within a live session — see #1417.
  searchText?: string;
  listChanged: boolean;
  onRefreshList: () => void;
  onSearchChange: (value: string) => void;
  onSelectApp: (name: string) => void;
}

const LIST_MAX_HEIGHT =
  "calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2 - 220px)";

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

export function AppControls({
  tools,
  selectedName,
  searchText = "",
  listChanged,
  onRefreshList,
  onSearchChange,
  onSelectApp,
}: AppControlsProps) {
  const viewportRef = useScrollMemory("apps-sidebar");
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
        <Title order={4}>MCP Apps ({tools.length})</Title>
        <ListChangedIndicator visible={listChanged} onRefresh={onRefreshList} />
      </Group>
      <TextInput
        placeholder="Search apps..."
        value={searchText}
        onChange={(e) => onSearchChange(e.currentTarget.value)}
        rightSectionPointerEvents="auto"
        rightSection={
          searchText ? <ClearButton onClick={() => onSearchChange("")} /> : null
        }
      />
      <ScrollArea.Autosize viewportRef={viewportRef} mah={LIST_MAX_HEIGHT}>
        <Stack gap="xs">
          {filteredTools.length === 0 ? (
            <EmptyState>
              {tools.length === 0 ? "No apps available" : "No matching apps"}
            </EmptyState>
          ) : (
            filteredTools.map((tool) => (
              <AppListItem
                key={tool.name}
                tool={tool}
                selected={tool.name === selectedName}
                onClick={() => {
                  if (tool.name !== selectedName) onSelectApp(tool.name);
                }}
              />
            ))
          )}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}
