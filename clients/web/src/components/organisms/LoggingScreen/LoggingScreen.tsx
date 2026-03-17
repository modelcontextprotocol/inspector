import {
  Button,
  Checkbox,
  Grid,
  Group,
  Paper,
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

export function LoggingScreen({
  controls,
  entries,
  autoScroll,
  onToggleAutoScroll,
  onCopyAll,
}: LoggingScreenProps) {
  return (
    <Grid>
      <Grid.Col span={3}>
        <Paper withBorder p="md">
          <LogControls {...controls} />
        </Paper>
      </Grid.Col>
      <Grid.Col span={9}>
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Title order={4}>Log Stream</Title>
              <Group>
                <Checkbox
                  label="Auto-scroll"
                  checked={autoScroll}
                  onChange={onToggleAutoScroll}
                />
                <Button variant="light" size="sm" onClick={onCopyAll}>
                  Copy All
                </Button>
              </Group>
            </Group>
            <ScrollArea h={500}>
              <Stack gap="xs">
                {entries.map((entry, index) => (
                  <LogEntry key={index} {...entry} />
                ))}
              </Stack>
            </ScrollArea>
            {entries.length === 0 && (
              <Text c="dimmed" ta="center">
                No log entries
              </Text>
            )}
          </Stack>
        </Paper>
      </Grid.Col>
    </Grid>
  );
}
