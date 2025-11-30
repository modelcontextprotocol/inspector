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
  Group,
} from '@mantine/core';

// Mock resources data
const mockResources = [
  { uri: 'file:///config.json', mimeType: 'application/json' },
  { uri: 'file:///readme.md', mimeType: 'text/markdown' },
  { uri: 'file:///data.csv', mimeType: 'text/csv' },
];

const mockTemplates = [
  { uriTemplate: 'user/{id}', description: 'Get user by ID' },
  { uriTemplate: 'file/{path}', description: 'Read file by path' },
];

export function Resources() {
  return (
    <Grid gutter="md" h="calc(100vh - 100px)">
      {/* Resource List Panel (35%) */}
      <Grid.Col span={4}>
        <Card h="100%" withBorder>
          <Stack gap="sm">
            <Group justify="space-between">
              <TextInput placeholder="Search..." size="sm" style={{ flex: 1 }} />
              <Button variant="subtle" size="sm">
                Refresh
              </Button>
            </Group>

            <ScrollArea h="calc(100vh - 300px)">
              <Stack gap="xs">
                <Text size="xs" fw={600} c="dimmed">
                  Resources
                </Text>
                {mockResources.map((resource, index) => (
                  <Button
                    key={resource.uri}
                    variant={index === 0 ? 'filled' : 'subtle'}
                    justify="start"
                    fullWidth
                    size="sm"
                  >
                    {resource.uri.split('/').pop()}
                  </Button>
                ))}

                <Text size="xs" fw={600} c="dimmed" mt="md">
                  Templates
                </Text>
                {mockTemplates.map((template) => (
                  <Button
                    key={template.uriTemplate}
                    variant="subtle"
                    justify="start"
                    fullWidth
                    size="sm"
                  >
                    {template.uriTemplate}
                  </Button>
                ))}
              </Stack>
            </ScrollArea>
          </Stack>
        </Card>
      </Grid.Col>

      {/* Content Preview Panel (65%) */}
      <Grid.Col span={8}>
        <Card h="100%" withBorder>
          <Stack gap="md">
            <Box>
              <Text size="sm" c="dimmed">
                URI: file:///config.json
              </Text>
              <Text size="sm" c="dimmed">
                MIME: application/json
              </Text>
            </Box>

            <ScrollArea h="calc(100vh - 280px)">
              <Code block>
                {JSON.stringify(
                  {
                    name: 'my-app',
                    version: '1.0.0',
                    description: 'Sample configuration file',
                  },
                  null,
                  2
                )}
              </Code>
            </ScrollArea>

            <Group>
              <Button variant="outline" size="xs">
                Copy
              </Button>
              <Button variant="outline" size="xs">
                Subscribe
              </Button>
            </Group>
          </Stack>
        </Card>
      </Grid.Col>
    </Grid>
  );
}
