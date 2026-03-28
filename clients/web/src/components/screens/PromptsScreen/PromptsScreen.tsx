import { Card, Container, Grid, Stack, Text } from "@mantine/core";
import { PromptArgumentsForm } from "../../groups/PromptArgumentsForm/PromptArgumentsForm";
import { PromptMessagesDisplay } from "../../groups/PromptMessagesDisplay/PromptMessagesDisplay";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import type { PromptArgumentsFormProps } from "../../groups/PromptArgumentsForm/PromptArgumentsForm";
import type { PromptMessagesDisplayProps } from "../../groups/PromptMessagesDisplay/PromptMessagesDisplay";

export interface PromptsScreenProps {
  promptForm: PromptArgumentsFormProps;
  messages?: PromptMessagesDisplayProps;
  listChanged: boolean;
  onRefreshList: () => void;
}

const PageContainer = Container.withProps({
  size: "xl",
  py: "xl",
});

const FullHeightCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  h: "100%",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

export function PromptsScreen({
  promptForm,
  messages,
  listChanged,
  onRefreshList,
}: PromptsScreenProps) {
  return (
    <PageContainer>
      <Grid align="stretch">
        <Grid.Col span={5}>
          <FullHeightCard>
            <Stack gap="md">
              <ListChangedIndicator
                visible={listChanged}
                onRefresh={onRefreshList}
              />
              <PromptArgumentsForm {...promptForm} />
            </Stack>
          </FullHeightCard>
        </Grid.Col>
        <Grid.Col span={7}>
          <FullHeightCard>
            {messages ? (
              <PromptMessagesDisplay {...messages} />
            ) : (
              <EmptyState>
                Select a prompt and click Get Prompt to see messages
              </EmptyState>
            )}
          </FullHeightCard>
        </Grid.Col>
      </Grid>
    </PageContainer>
  );
}
