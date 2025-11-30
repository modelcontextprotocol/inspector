import {
  Grid,
  Card,
  Text,
  TextInput,
  Stack,
  Button,
  ScrollArea,
  Box,
  Title,
  Code,
} from '@mantine/core';

// Mock tools data
const mockTools = [
  { name: 'echo', description: 'Echoes the input message' },
  { name: 'add', description: 'Adds two numbers together' },
  { name: 'longRunningOperation', description: 'A long-running operation for testing' },
  { name: 'sampleLLM', description: 'Samples from an LLM' },
];

export function Tools() {
  return (
    <Grid gutter="md" h="calc(100vh - 100px)">
      {/* Tool List Panel (30%) */}
      <Grid.Col span={3}>
        <Card h="100%" withBorder>
          <Stack gap="sm">
            <TextInput placeholder="Search tools..." size="sm" />
            <ScrollArea h="calc(100vh - 200px)">
              <Stack gap="xs">
                {mockTools.map((tool, index) => (
                  <Button
                    key={tool.name}
                    variant={index === 0 ? 'filled' : 'subtle'}
                    justify="start"
                    fullWidth
                  >
                    {tool.name}
                  </Button>
                ))}
              </Stack>
            </ScrollArea>
          </Stack>
        </Card>
      </Grid.Col>

      {/* Parameters Panel (40%) */}
      <Grid.Col span={5}>
        <Card h="100%" withBorder>
          <Stack gap="md">
            <Box>
              <Title order={4}>Tool: echo</Title>
              <Text size="sm" c="dimmed">
                Echoes the input message
              </Text>
            </Box>

            <Stack gap="sm">
              <TextInput
                label="message"
                placeholder="Enter message..."
                required
              />
            </Stack>

            <Button>Execute Tool</Button>
          </Stack>
        </Card>
      </Grid.Col>

      {/* Results Panel (30%) */}
      <Grid.Col span={4}>
        <Card h="100%" withBorder>
          <Stack gap="md">
            <Title order={4}>Results</Title>
            <ScrollArea h="calc(100vh - 250px)">
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
            <Button variant="outline" size="xs">
              Copy
            </Button>
          </Stack>
        </Card>
      </Grid.Col>
    </Grid>
  );
}
