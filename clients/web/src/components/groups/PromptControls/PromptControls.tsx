import { Group, ScrollArea, Stack, TextInput, Title } from "@mantine/core";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { PromptListItem } from "../PromptListItem/PromptListItem";
import type { PromptItem } from "../../screens/PromptsScreen/PromptsScreen";

export interface PromptControlsProps {
  prompts: PromptItem[];
  listChanged: boolean;
  searchText: string;
  onSearchChange: (text: string) => void;
  onRefreshList: () => void;
  onSelectPrompt: (name: string) => void;
}

function listMaxHeight(): string {
  return "calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2 - 160px)";
}

export function PromptControls({
  prompts,
  listChanged,
  searchText,
  onSearchChange,
  onRefreshList,
  onSelectPrompt,
}: PromptControlsProps) {
  const filteredPrompts = prompts.filter((p) =>
    p.name.toLowerCase().includes(searchText.toLowerCase()),
  );

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={4}>Prompts</Title>
        <ListChangedIndicator visible={listChanged} onRefresh={onRefreshList} />
      </Group>
      <TextInput
        placeholder="Search prompts..."
        value={searchText}
        onChange={(e) => onSearchChange(e.currentTarget.value)}
      />
      <ScrollArea.Autosize mah={listMaxHeight()}>
        <Stack gap="xs">
          {filteredPrompts.map((prompt) => (
            <PromptListItem
              key={prompt.name}
              name={prompt.name}
              description={prompt.description}
              selected={prompt.selected}
              onClick={() => onSelectPrompt(prompt.name)}
            />
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}
