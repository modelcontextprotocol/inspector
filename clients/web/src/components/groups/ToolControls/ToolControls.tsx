import { ScrollArea, Stack, TextInput, Title } from "@mantine/core";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { ToolListItem } from "../ToolListItem/ToolListItem";
import type { ToolListItemProps } from "../ToolListItem/ToolListItem";

export interface ToolControlsProps {
  tools: ToolListItemProps[];
  listChanged: boolean;
  searchText: string;
  onSearchChange: (text: string) => void;
  onRefreshList: () => void;
  onSelectTool: (name: string) => void;
}

function listMaxHeight(): string {
  return "calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2 - 160px)";
}

export function ToolControls({
  tools,
  listChanged,
  searchText,
  onSearchChange,
  onRefreshList,
  onSelectTool,
}: ToolControlsProps) {
  const filteredTools = searchText
    ? tools.filter((tool) =>
        tool.name.toLowerCase().includes(searchText.toLowerCase()),
      )
    : tools;

  return (
    <Stack gap="sm">
      <Title order={4}>Tools</Title>
      <ListChangedIndicator visible={listChanged} onRefresh={onRefreshList} />
      <TextInput
        placeholder="Search tools..."
        value={searchText}
        onChange={(e) => onSearchChange(e.currentTarget.value)}
      />
      <ScrollArea.Autosize mah={listMaxHeight()}>
        <Stack gap="xs">
          {filteredTools.map((tool) => (
            <ToolListItem
              key={tool.name}
              {...tool}
              onClick={() => onSelectTool(tool.name)}
            />
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}
