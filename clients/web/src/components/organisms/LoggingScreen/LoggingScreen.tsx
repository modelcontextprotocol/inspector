import {
  Button,
  Checkbox,
  Container,
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
    <Container size="xl" py="xl">
    <Grid align="stretch">
      <Grid.Col span={3}>
        <Paper withBorder p="md" h="100%">
          <LogControls {...controls} />
        </Paper>
      </Grid.Col>
      <Grid.Col span={9}>
        <Paper withBorder p="md" h="100%">
          <Stack gap="sm" h="100%">
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
            {entries.length > 0 ? (
              <ScrollArea flex={1}>
                <Stack gap="xs">
                  {entries.map((entry, index) => (
                    <LogEntry key={index} {...entry} />
                  ))}
                </Stack>
              </ScrollArea>
            ) : (
              <Stack flex={1} align="center" justify="center">
                <Text c="dimmed">No log entries</Text>
              </Stack>
            )}
          </Stack>
        </Paper>
      </Grid.Col>
    </Grid>
    </Container>
  );
}
