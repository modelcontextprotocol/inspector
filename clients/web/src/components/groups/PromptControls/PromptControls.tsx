import { Group, ScrollArea, Stack, TextInput, Title } from "@mantine/core";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { PromptListItem } from "../PromptListItem/PromptListItem";
import { useScrollMemory } from "../../../hooks/useScrollMemory";

export interface PromptControlsProps {
  prompts: Prompt[];
  selectedName?: string;
  // Search text is controlled by the parent (App, via PromptsScreen) so it
  // persists across tab navigation within a live session — see #1417.
  searchText?: string;
  listChanged: boolean;
  onRefreshList: () => void;
  onSearchChange: (value: string) => void;
  onSelectPrompt: (name: string) => void;
}

const LIST_MAX_HEIGHT =
  "calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2 - 160px)";

export function PromptControls({
  prompts,
  selectedName,
  searchText = "",
  listChanged,
  onRefreshList,
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
      <ScrollArea.Autosize viewportRef={viewportRef} mah={LIST_MAX_HEIGHT}>
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
      </ScrollArea.Autosize>
    </Stack>
  );
}
