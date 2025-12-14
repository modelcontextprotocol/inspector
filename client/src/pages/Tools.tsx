import { useState } from 'react';
import {
  Grid,
  Card,
  Text,
  TextInput,
  Stack,
  Button,
  ScrollArea,
  Title,
  Code,
  Group,
} from '@mantine/core';
import { ListChangedIndicator } from '../components/ListChangedIndicator';
import { AnnotationBadges } from '../components/AnnotationBadges';
import { mockTools, type Tool } from '@/mocks';

export function Tools() {
  const [hasToolsChanged, setHasToolsChanged] = useState(true);
  const [selectedTool, setSelectedTool] = useState<Tool>(mockTools[0]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  const handleRefresh = () => {
    setHasToolsChanged(false);
  };

  const handleExecute = () => {
    setIsExecuting(true);
    // Simulate execution completing
    setTimeout(() => {
      setIsExecuting(false);
    }, 500);
  };

  const handleCancel = () => {
    setIsExecuting(false);
  };

  const filteredTools = mockTools.filter((tool) =>
    tool.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <Grid gutter="md" h="calc(100vh - 120px)">
      {/* Tool List Panel (3/12) */}
      <Grid.Col span={3}>
        <Card h="100%" withBorder style={{ display: 'flex', flexDirection: 'column' }}>
          <Stack gap="xs" p="md">
            <Group justify="space-between">
              <Title order={5}>Tools ({mockTools.length})</Title>
            </Group>
            <ListChangedIndicator
              hasChanges={hasToolsChanged}
              onRefresh={handleRefresh}
              label="List updated"
            />
          </Stack>
          <Stack gap="sm" p="md" pt={0} flex={1} style={{ overflow: 'hidden' }}>
            <TextInput
              placeholder="Search tools..."
              size="sm"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
            <ScrollArea flex={1}>
              <Stack gap="xs">
                {filteredTools.map((tool) => (
                  <Stack key={tool.name} gap={4}>
                    <Button
                      variant={selectedTool.name === tool.name ? 'filled' : 'subtle'}
                      justify="flex-start"
                      fullWidth
                      onClick={() => setSelectedTool(tool)}
                    >
                      {tool.name}
                    </Button>
                    {/* Annotation badges below tool name */}
                    <AnnotationBadges
                      annotations={tool.annotations}
                      className="pl-sm pb-xs"
                    />
                  </Stack>
                ))}
              </Stack>
            </ScrollArea>
          </Stack>
        </Card>
      </Grid.Col>

      {/* Parameters Panel (5/12) */}
      <Grid.Col span={5}>
        <Card h="100%" withBorder>
          <Stack gap="md" p="md">
            <Stack gap={4}>
              <Title order={4}>Tool: {selectedTool.name}</Title>
              <Text size="sm" c="dimmed">{selectedTool.description}</Text>
            </Stack>

            {/* Display annotations */}
            {selectedTool.annotations && Object.keys(selectedTool.annotations).length > 0 && (
              <Stack gap="xs">
                <Text size="sm" fw={500}>Annotations:</Text>
                <Group gap="md">
                  {selectedTool.annotations.audience && (
                    <Text size="sm" c="dimmed">
                      Audience: {selectedTool.annotations.audience}
                    </Text>
                  )}
                  {selectedTool.annotations.readOnly && (
                    <Text size="sm" c="dimmed">Read-only: true</Text>
                  )}
                  {selectedTool.annotations.destructive && (
                    <Text size="sm" c="red">Destructive: true</Text>
                  )}
                  {selectedTool.annotations.longRunning && (
                    <Text size="sm" c="yellow">Long-running: true</Text>
                  )}
                </Group>
                {selectedTool.annotations.hints && (
                  <Text size="sm" c="dimmed" fs="italic">
                    Hints: "{selectedTool.annotations.hints}"
                  </Text>
                )}
              </Stack>
            )}

            <TextInput
              label={
                <Text size="sm">
                  message <Text span c="red">*</Text>
                </Text>
              }
              placeholder="Enter message..."
              disabled={isExecuting}
            />

            {/* Autocomplete placeholder - for future completion/complete integration */}
            <Text size="xs" c="dimmed" fs="italic">
              Suggestions: Type to see completions (completion/complete integration pending)
            </Text>

            {/* Execute / Cancel buttons */}
            <Group gap="sm">
              <Button flex={1} onClick={handleExecute} disabled={isExecuting}>
                {isExecuting ? 'Executing...' : 'Execute Tool'}
              </Button>
              {isExecuting && (
                <Button variant="outline" color="red" onClick={handleCancel}>
                  Cancel
                </Button>
              )}
            </Group>
          </Stack>
        </Card>
      </Grid.Col>

      {/* Results Panel (4/12) */}
      <Grid.Col span={4}>
        <Card h="100%" withBorder>
          <Stack gap="md" p="md">
            <Title order={4}>Results</Title>
            <ScrollArea flex={1} mah="60vh">
              <Code block>
                {JSON.stringify(
                  {
                    content: [
                      {
                        type: 'text',
                        text: 'Hello, world!',
                      },
                    ],
                  },
                  null,
                  2
                )}
              </Code>
            </ScrollArea>
            <Group gap="sm">
              <Button variant="outline" size="xs">
                Copy
              </Button>
              <Button variant="outline" size="xs">
                Clear
              </Button>
            </Group>
          </Stack>
        </Card>
      </Grid.Col>
    </Grid>
  );
}
