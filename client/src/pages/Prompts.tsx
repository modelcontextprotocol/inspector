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
  Select,
} from '@mantine/core';

// Mock prompts data
const mockPrompts = [
  { name: 'greeting_prompt', description: 'Generate a greeting' },
  { name: 'summarize', description: 'Summarize text' },
];

export function Prompts() {
  return (
    <Grid gutter="md" h="calc(100vh - 100px)">
      {/* Prompt Selection Panel (35%) */}
      <Grid.Col span={4}>
        <Card h="100%" withBorder>
          <Stack gap="md">
            <Select
              label="Select Prompt"
              placeholder="Choose a prompt..."
              data={mockPrompts.map((p) => ({ value: p.name, label: p.name }))}
              defaultValue="greeting_prompt"
            />

            <Box>
              <Title order={5}>Arguments</Title>
            </Box>

            <Stack gap="sm">
              <Box>
                <TextInput label="name" placeholder="Enter name..." required />
                {/* Autocomplete placeholder - for future completion/complete integration (UI-14) */}
                <Text size="xs" c="dimmed" fs="italic" mt={4}>
                  Suggestions: Type to see completions
                </Text>
              </Box>
              <Box>
                <TextInput label="interests" placeholder="Enter interests..." />
                {/* Autocomplete placeholder - for future completion/complete integration (UI-14) */}
                <Text size="xs" c="dimmed" fs="italic" mt={4}>
                  Suggestions: Type to see completions
                </Text>
              </Box>
            </Stack>

            <Button>Get Prompt</Button>
          </Stack>
        </Card>
      </Grid.Col>

      {/* Result Panel (65%) */}
      <Grid.Col span={8}>
        <Card h="100%" withBorder>
          <Stack gap="md">
            <Title order={4}>Messages</Title>

            <ScrollArea h="calc(100vh - 250px)">
              <Stack gap="md">
                <Card withBorder p="sm">
                  <Text size="xs" fw={600} c="dimmed">
                    [0] role: user
                  </Text>
                  <Text size="sm">
                    "Hello, my name is John and I like cats"
                  </Text>
                </Card>

                <Card withBorder p="sm">
                  <Text size="xs" fw={600} c="dimmed">
                    [1] role: assistant
                  </Text>
                  <Text size="sm">
                    "Nice to meet you, John! It's wonderful that you enjoy cats..."
                  </Text>
                </Card>
              </Stack>
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
