import {
  Button,
  Card,
  Checkbox,
  Container,
  Grid,
  Group,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { LogControls } from "../../molecules/LogControls/LogControls";
import { LogEntry } from "../../atoms/LogEntry/LogEntry";
import type { LogControlsProps } from "../../molecules/LogControls/LogControls";
import type { LogEntryProps } from "../../atoms/LogEntry/LogEntry";

export interface LoggingScreenProps {
  controls: LogControlsProps;
  entries: LogEntryProps[];
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  onCopyAll: () => void;
}

const PageContainer = Container.withProps({
  size: "xl",
  py: "xl",
});

const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
});

const FullHeightCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  h: "100%",
});

const FullHeightStack = Stack.withProps({
  gap: "sm",
  h: "100%",
});

const ToolbarButton = Button.withProps({
  variant: "light",
  size: "sm",
});

const EmptyCenter = Stack.withProps({
  flex: 1,
  align: "center",
  justify: "center",
});

export function LoggingScreen({
  controls,
  entries,
  autoScroll,
  onToggleAutoScroll,
  onCopyAll,
}: LoggingScreenProps) {
  return (
    <PageContainer>
      <Grid align="stretch">
        <Grid.Col span={3}>
          <SidebarCard>
            <LogControls {...controls} />
          </SidebarCard>
        </Grid.Col>
        <Grid.Col span={9}>
          <FullHeightCard>
            <FullHeightStack>
              <Group justify="space-between">
                <Title order={4}>Log Stream</Title>
                <Group>
                  <Checkbox
                    label="Auto-scroll"
                    checked={autoScroll}
                    onChange={onToggleAutoScroll}
                  />
                  <ToolbarButton onClick={onCopyAll}>Copy All</ToolbarButton>
                </Group>
              </Group>
              {entries.length > 0 ? (
                <ScrollArea flex={1}>
                  <Stack gap="xs">
                    {entries.map((entry, index) => (
                      <LogEntry key={index} {...entry} />
                    ))}
                  </Stack>
                </ScrollArea>
              ) : (
                <EmptyCenter>
                  <Text c="dimmed">No log entries</Text>
                </EmptyCenter>
              )}
            </FullHeightStack>
          </FullHeightCard>
        </Grid.Col>
      </Grid>
    </PageContainer>
  );
}
