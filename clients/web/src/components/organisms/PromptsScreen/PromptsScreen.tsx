import { Grid, Paper, Stack, Text } from "@mantine/core";
import { PromptArgumentsForm } from "../../molecules/PromptArgumentsForm/PromptArgumentsForm";
import { PromptMessagesDisplay } from "../../molecules/PromptMessagesDisplay/PromptMessagesDisplay";
import { ListChangedIndicator } from "../../atoms/ListChangedIndicator/ListChangedIndicator";
import type { PromptArgumentsFormProps } from "../../molecules/PromptArgumentsForm/PromptArgumentsForm";
import type { PromptMessagesDisplayProps } from "../../molecules/PromptMessagesDisplay/PromptMessagesDisplay";

export interface PromptsScreenProps {
  promptForm: PromptArgumentsFormProps;
  messages?: PromptMessagesDisplayProps;
  listChanged: boolean;
  onRefreshList: () => void;
}

export function PromptsScreen({
  promptForm,
  messages,
  listChanged,
  onRefreshList,
}: PromptsScreenProps) {
  return (
    <Grid>
      <Grid.Col span={5}>
        <Paper withBorder p="md">
          <Stack gap="md">
            <ListChangedIndicator
              visible={listChanged}
              onRefresh={onRefreshList}
            />
            <PromptArgumentsForm {...promptForm} />
          </Stack>
        </Paper>
      </Grid.Col>
      <Grid.Col span={7}>
        <Paper withBorder p="md">
          {messages ? (
            <PromptMessagesDisplay {...messages} />
          ) : (
            <Text c="dimmed" ta="center" py="xl">
              Select a prompt and click Get Prompt to see messages
            </Text>
          )}
        </Paper>
      </Grid.Col>
    </Grid>
  );
}
