import { useState } from 'react';
import {
  Grid,
  Card,
  Text,
  TextInput,
  Stack,
  Button,
  ScrollArea,
  Code,
  Group,
  Title,
  Badge,
} from '@mantine/core';
import { ListChangedIndicator } from '../components/ListChangedIndicator';

// Resource interface with annotations per MCP spec
interface Resource {
  uri: string;
  mimeType: string;
  annotations?: {
    audience?: 'user' | 'application';
    priority?: number; // 0-1
  };
}

interface ResourceTemplate {
  uriTemplate: string;
  description: string;
}

interface Subscription {
  uri: string;
  lastUpdated: string;
}

// Mock resources data with annotations
const mockResources: Resource[] = [
  {
    uri: 'file:///config.json',
    mimeType: 'application/json',
    annotations: { audience: 'application', priority: 0.9 },
  },
  {
    uri: 'file:///readme.md',
    mimeType: 'text/markdown',
    annotations: { audience: 'user' },
  },
  {
    uri: 'file:///data.csv',
    mimeType: 'text/csv',
    annotations: { priority: 0.5 },
  },
];

const mockTemplates: ResourceTemplate[] = [
  { uriTemplate: 'user/{id}', description: 'Get user by ID' },
  { uriTemplate: 'file/{path}', description: 'Read file by path' },
];

const mockSubscriptions: Subscription[] = [
  { uri: 'file:///config.json', lastUpdated: '2025-11-30T14:32:05Z' },
];

function getPriorityLabel(priority: number): { label: string; color: string } {
  if (priority > 0.7) return { label: 'high', color: 'yellow' };
  if (priority > 0.3) return { label: 'medium', color: 'gray' };
  return { label: 'low', color: 'blue' };
}

export function Resources() {
  const [hasResourcesChanged, setHasResourcesChanged] = useState(true);
  const [selectedResource, setSelectedResource] = useState<Resource>(mockResources[0]);
  const [searchFilter, setSearchFilter] = useState('');
  const [templateInputs, setTemplateInputs] = useState<Record<string, string>>({});
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(mockSubscriptions);

  const handleRefresh = () => {
    setHasResourcesChanged(false);
  };

  const handleTemplateInputChange = (template: string, value: string) => {
    setTemplateInputs((prev) => ({ ...prev, [template]: value }));
  };

  const handleTemplateGo = (template: ResourceTemplate) => {
    const value = templateInputs[template.uriTemplate] || '';
    // Extract variable name from template
    const varMatch = template.uriTemplate.match(/\{(\w+)\}/);
    if (varMatch && value) {
      const resolvedUri = template.uriTemplate.replace(`{${varMatch[1]}}`, value);
      console.log('Resolving template:', resolvedUri);
      // In real implementation, would fetch the resolved resource
    }
  };

  const handleSubscribe = () => {
    if (!subscriptions.find((s) => s.uri === selectedResource.uri)) {
      setSubscriptions((prev) => [
        ...prev,
        { uri: selectedResource.uri, lastUpdated: new Date().toISOString() },
      ]);
    }
  };

  const handleUnsubscribe = (uri: string) => {
    setSubscriptions((prev) => prev.filter((s) => s.uri !== uri));
  };

  const filteredResources = mockResources.filter((resource) =>
    resource.uri.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const isSubscribed = subscriptions.some((s) => s.uri === selectedResource.uri);

  return (
    <Grid gutter="md" h="calc(100vh - 120px)">
      {/* Resource List Panel (4/12) */}
      <Grid.Col span={4}>
        <Card h="100%" withBorder style={{ display: 'flex', flexDirection: 'column' }}>
          <Stack gap="xs" p="md">
            <Group justify="space-between">
              <Title order={5}>Resources ({mockResources.length})</Title>
            </Group>
            <ListChangedIndicator
              hasChanges={hasResourcesChanged}
              onRefresh={handleRefresh}
              label="List updated"
            />
          </Stack>
          <Stack gap="sm" p="md" pt={0} flex={1} style={{ overflow: 'hidden' }}>
            <TextInput
              placeholder="Search..."
              size="sm"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />

            <ScrollArea flex={1}>
              <Stack gap="sm">
                {/* Resources Section */}
                <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                  Resources
                </Text>
                <Stack gap="xs">
                  {filteredResources.map((resource) => (
                    <Stack key={resource.uri} gap={4}>
                      <Button
                        variant={selectedResource.uri === resource.uri ? 'filled' : 'subtle'}
                        justify="flex-start"
                        fullWidth
                        size="sm"
                        onClick={() => setSelectedResource(resource)}
                      >
                        {resource.uri.split('/').pop()}
                      </Button>
                      {/* Annotation badges */}
                      {resource.annotations && Object.keys(resource.annotations).length > 0 && (
                        <Group gap={4} pl="sm" pb={4}>
                          {resource.annotations.audience && (
                            <Badge size="xs" variant="light">
                              {resource.annotations.audience}
                            </Badge>
                          )}
                          {resource.annotations.priority !== undefined && (
                            <Badge
                              size="xs"
                              color={getPriorityLabel(resource.annotations.priority).color}
                            >
                              priority: {getPriorityLabel(resource.annotations.priority).label}
                            </Badge>
                          )}
                        </Group>
                      )}
                    </Stack>
                  ))}
                </Stack>

                {/* Templates Section */}
                <Text size="xs" fw={600} c="dimmed" tt="uppercase" mt="md">
                  Templates
                </Text>
                <Stack gap="xs">
                  {mockTemplates.map((template) => {
                    const varMatch = template.uriTemplate.match(/\{(\w+)\}/);
                    const varName = varMatch ? varMatch[1] : '';
                    return (
                      <Stack key={template.uriTemplate} gap={4}>
                        <Text size="sm" c="dimmed">{template.uriTemplate}</Text>
                        <Group gap={4}>
                          <TextInput
                            placeholder={varName}
                            size="xs"
                            flex={1}
                            value={templateInputs[template.uriTemplate] || ''}
                            onChange={(e) =>
                              handleTemplateInputChange(template.uriTemplate, e.target.value)
                            }
                          />
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => handleTemplateGo(template)}
                          >
                            Go
                          </Button>
                        </Group>
                      </Stack>
                    );
                  })}
                </Stack>

                {/* Subscriptions Section */}
                {subscriptions.length > 0 && (
                  <>
                    <Text size="xs" fw={600} c="dimmed" tt="uppercase" mt="md">
                      Subscriptions
                    </Text>
                    <Stack gap="xs">
                      {subscriptions.map((sub) => (
                        <Group key={sub.uri} justify="space-between" py={4}>
                          <Group gap="xs">
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                backgroundColor: 'var(--mantine-color-green-5)',
                              }}
                            />
                            <Text size="sm" style={{ maxWidth: 120 }} truncate>
                              {sub.uri.split('/').pop()}
                            </Text>
                          </Group>
                          <Button
                            variant="subtle"
                            size="xs"
                            onClick={() => handleUnsubscribe(sub.uri)}
                          >
                            Unsub
                          </Button>
                        </Group>
                      ))}
                    </Stack>
                  </>
                )}
              </Stack>
            </ScrollArea>
          </Stack>
        </Card>
      </Grid.Col>

      {/* Content Preview Panel (8/12) */}
      <Grid.Col span={8}>
        <Card h="100%" withBorder>
          <Stack gap="md" p="md">
            <Title order={5}>Content Preview</Title>

            <Stack gap={4}>
              <Text size="sm">
                <Text span c="dimmed">URI:</Text> {selectedResource.uri}
              </Text>
              <Text size="sm">
                <Text span c="dimmed">MIME:</Text> {selectedResource.mimeType}
              </Text>
            </Stack>

            {/* Display annotations */}
            {selectedResource.annotations &&
              Object.keys(selectedResource.annotations).length > 0 && (
                <Stack gap="xs">
                  <Text size="sm" fw={500}>Annotations:</Text>
                  <Group gap="md">
                    {selectedResource.annotations.audience && (
                      <Text size="sm" c="dimmed">
                        Audience: {selectedResource.annotations.audience}
                      </Text>
                    )}
                    {selectedResource.annotations.priority !== undefined && (
                      <Text size="sm" c="dimmed">
                        Priority: {selectedResource.annotations.priority.toFixed(1)} (
                        {getPriorityLabel(selectedResource.annotations.priority).label})
                      </Text>
                    )}
                  </Group>
                </Stack>
              )}

            <ScrollArea mah="50vh">
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

            <Group justify="space-between">
              <Group gap="sm">
                <Button variant="outline" size="sm">
                  Copy
                </Button>
                {isSubscribed ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUnsubscribe(selectedResource.uri)}
                  >
                    Unsubscribe
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={handleSubscribe}>
                    Subscribe
                  </Button>
                )}
              </Group>
              {isSubscribed && (
                <Text size="xs" c="dimmed">
                  Last updated:{' '}
                  {new Date(
                    subscriptions.find((s) => s.uri === selectedResource.uri)?.lastUpdated || ''
                  ).toLocaleTimeString()}
                </Text>
              )}
            </Group>
          </Stack>
        </Card>
      </Grid.Col>
    </Grid>
  );
}
