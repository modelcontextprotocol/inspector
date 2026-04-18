import { Card, Flex, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { PromptControls } from "../../groups/PromptControls/PromptControls";
import { PromptArgumentsForm } from "../../groups/PromptArgumentsForm/PromptArgumentsForm";
import { PromptMessagesDisplay } from "../../groups/PromptMessagesDisplay/PromptMessagesDisplay";
import type { PromptArgument } from "../../groups/PromptArgumentsForm/PromptArgumentsForm";
import type { PromptMessagesDisplayProps } from "../../groups/PromptMessagesDisplay/PromptMessagesDisplay";

export interface PromptItem {
  name: string;
  description?: string;
  selected: boolean;
}

export interface SelectedPrompt {
  name: string;
  description?: string;
  arguments: PromptArgument[];
  argumentValues: Record<string, string>;
}

export interface PromptsScreenProps {
  prompts: PromptItem[];
  selectedPrompt?: SelectedPrompt;
  messages?: PromptMessagesDisplayProps;
  listChanged: boolean;
  onRefreshList: () => void;
  onSelectPrompt: (name: string) => void;
  onArgumentChange: (name: string, value: string) => void;
  onGetPrompt: () => void;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100vh - var(--app-shell-header-height, 0px))",
  gap: "md",
  p: "xl",
});

const Sidebar = Stack.withProps({
  w: 340,
  flex: "0 0 auto",
});

const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
});

const DetailCard = Card.withProps({
  flex: 1,
  withBorder: true,
  padding: "lg",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

export function PromptsScreen({
  prompts,
  selectedPrompt,
  messages,
  listChanged,
  onRefreshList,
  onSelectPrompt,
  onArgumentChange,
  onGetPrompt,
}: PromptsScreenProps) {
  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <PromptControls
            prompts={prompts}
            listChanged={listChanged}
            onRefreshList={onRefreshList}
            onSelectPrompt={onSelectPrompt}
          />
        </SidebarCard>
      </Sidebar>

      <ScrollArea.Autosize
        flex={1}
        mah="calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2)"
      >
        <Group flex={1} gap="md" align="flex-start" wrap="nowrap">
          {selectedPrompt ? (
            <>
              <DetailCard>
                <PromptArgumentsForm
                  name={selectedPrompt.name}
                  description={selectedPrompt.description}
                  arguments={selectedPrompt.arguments}
                  argumentValues={selectedPrompt.argumentValues}
                  onArgumentChange={onArgumentChange}
                  onGetPrompt={onGetPrompt}
                />
              </DetailCard>
              {messages && (
                <DetailCard>
                  <PromptMessagesDisplay {...messages} />
                </DetailCard>
              )}
            </>
          ) : (
            <DetailCard>
              <EmptyState>Select a prompt to view details</EmptyState>
            </DetailCard>
          )}
        </Group>
      </ScrollArea.Autosize>
    </ScreenLayout>
  );
}
