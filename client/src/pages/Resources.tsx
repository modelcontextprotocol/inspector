import { useState, useEffect } from 'react';
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
  Collapse,
  UnstyledButton,
  Paper,
  Loader,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconPlugConnectedX, IconAlertCircle } from '@tabler/icons-react';
import { ListChangedIndicator } from '../components/ListChangedIndicator';
import { AnnotationBadges, getPriorityLabel } from '../components/AnnotationBadges';
import { useMcp } from '@/context';
import { useMcpResources } from '@/hooks';
import type { Resource, ResourceTemplate } from '@modelcontextprotocol/sdk/types.js';

// NOTE: Using useMcpResources instead of useTrackedMcpResources.
// Tracked version (with history/logging) will be added in PR #3.

// Collapsible section component for accordion pattern
interface AccordionSectionProps {
  title: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function AccordionSection({ title, count, isOpen, onToggle, children }: AccordionSectionProps) {
  return (
    <Paper withBorder radius="md">
      <UnstyledButton
        onClick={onToggle}
        w="100%"
        p="xs"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {isOpen ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
        <Text size="sm" fw={500}>{title}</Text>
        <Text size="sm" c="dimmed">({count})</Text>
      </UnstyledButton>
      <Collapse in={isOpen}>
        <div style={{ padding: '0 var(--mantine-spacing-xs) var(--mantine-spacing-xs)', borderTop: '1px solid var(--mantine-color-dark-4)' }}>
          {children}
        </div>
      </Collapse>
    </Paper>
  );
}

export function Resources() {
  const { isConnected } = useMcp();
  const {
    resources,
    templates,
    subscriptions,
    isLoading,
    error,
    listChanged,
    readResource,
    subscribe,
    unsubscribe,
    refresh,
    clearListChanged,
  } = useMcpResources();

  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [templateInputs, setTemplateInputs] = useState<Record<string, string>>({});
  const [resourceContent, setResourceContent] = useState<string | null>(null);
  const [isReadingResource, setIsReadingResource] = useState(false);

  // Accordion state - Resources expanded by default, others collapsed
  const [expandedSections, setExpandedSections] = useState({
    resources: true,
    templates: false,
    subscriptions: false,
  });

  // Select first resource when resources load
  useEffect(() => {
    if (resources.length > 0 && !selectedResource) {
      setSelectedResource(resources[0]);
    }
  }, [resources, selectedResource]);

  // Read resource content when selection changes
  useEffect(() => {
    if (!selectedResource || !isConnected) {
      setResourceContent(null);
      return;
    }

    const fetchContent = async () => {
      setIsReadingResource(true);
      try {
        const result = await readResource(selectedResource.uri);
        // Format the content for display
        const content = result.contents
          .map((c: { text?: string; mimeType?: string; blob?: string }) => {
            if ('text' in c) return c.text;
            if ('blob' in c) return `[Binary data: ${c.mimeType || 'unknown'}]`;
            return JSON.stringify(c);
          })
          .join('\n');
        setResourceContent(content);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to read resource';
        setResourceContent(`Error: ${message}`);
      } finally {
        setIsReadingResource(false);
      }
    };

    fetchContent();
  // Note: readResourceTracked intentionally excluded from deps to prevent infinite loop
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedResource, isConnected]);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleRefresh = async () => {
    await refresh();
    clearListChanged();
  };

  const handleTemplateInputChange = (template: string, value: string) => {
    setTemplateInputs((prev) => ({ ...prev, [template]: value }));
  };

  const handleTemplateGo = async (template: ResourceTemplate) => {
    const value = templateInputs[template.uriTemplate] || '';
    // Extract variable name from template
    const varMatch = template.uriTemplate.match(/\{(\w+)\}/);
    if (varMatch && value) {
      const resolvedUri = template.uriTemplate.replace(`{${varMatch[1]}}`, value);
      console.log('Resolving template:', resolvedUri);

      // Read the resolved resource
      setIsReadingResource(true);
      try {
        const result = await readResource(resolvedUri);
        const content = result.contents
          .map((c: { text?: string; mimeType?: string; blob?: string }) => {
            if ('text' in c) return c.text;
            if ('blob' in c) return `[Binary data: ${c.mimeType || 'unknown'}]`;
            return JSON.stringify(c);
          })
          .join('\n');
        setResourceContent(content);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to read resource';
        setResourceContent(`Error: ${message}`);
      } finally {
        setIsReadingResource(false);
      }
    }
  };

  const handleSubscribe = async () => {
    if (selectedResource) {
      try {
        await subscribe(selectedResource.uri);
      } catch (err) {
        console.error('Failed to subscribe:', err);
      }
    }
  };

  const handleUnsubscribe = async (uri: string) => {
    try {
      await unsubscribe(uri);
    } catch (err) {
      console.error('Failed to unsubscribe:', err);
    }
  };

  // Filter all sections based on search
  const filteredResources = resources.filter((resource) =>
    resource.uri.toLowerCase().includes(searchFilter.toLowerCase())
  );
  const filteredTemplates = templates.filter(
    (t) =>
      t.uriTemplate.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (t.description?.toLowerCase().includes(searchFilter.toLowerCase()) ?? false)
  );
  const filteredSubscriptions = subscriptions.filter((s) =>
    s.uri.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const isSubscribed = selectedResource
    ? subscriptions.some((s) => s.uri === selectedResource.uri)
    : false;

  // Show disconnected state
  if (!isConnected) {
    return (
      <Grid gutter="md" h="calc(100vh - 120px)">
        <Grid.Col span={12}>
          <Card h="100%" withBorder>
            <Stack align="center" justify="center" h="100%" gap="md">
              <IconPlugConnectedX size={48} color="gray" />
              <Title order={3} c="dimmed">Not Connected</Title>
              <Text c="dimmed">Connect to an MCP server to view resources.</Text>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    );
  }

  // Show loading state
  if (isLoading && resources.length === 0) {
    return (
      <Grid gutter="md" h="calc(100vh - 120px)">
        <Grid.Col span={12}>
          <Card h="100%" withBorder>
            <Stack align="center" justify="center" h="100%" gap="md">
              <Loader size="lg" />
              <Text c="dimmed">Loading resources...</Text>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    );
  }

  // Show error state
  if (error) {
    return (
      <Grid gutter="md" h="calc(100vh - 120px)">
        <Grid.Col span={12}>
          <Card h="100%" withBorder>
            <Stack align="center" justify="center" h="100%" gap="md">
              <IconAlertCircle size={48} color="red" />
              <Title order={3} c="red">Error Loading Resources</Title>
              <Text c="dimmed">{error}</Text>
              <Button onClick={handleRefresh}>Retry</Button>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    );
  }

  // Show empty state if no resources capability
  if (resources.length === 0 && templates.length === 0) {
    return (
      <Grid gutter="md" h="calc(100vh - 120px)">
        <Grid.Col span={12}>
          <Card h="100%" withBorder>
            <Stack align="center" justify="center" h="100%" gap="md">
              <Title order={3} c="dimmed">No Resources Available</Title>
              <Text c="dimmed">This server does not expose any resources.</Text>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    );
  }

  return (
    <Grid gutter="md" h="calc(100vh - 120px)">
      {/* Resource List Panel (4/12) */}
      <Grid.Col span={4}>
        <Card h="100%" withBorder style={{ display: 'flex', flexDirection: 'column' }}>
          <Stack gap="xs" p="md">
            <Group justify="space-between">
              <Title order={5}>Resources ({resources.length})</Title>
            </Group>
            <ListChangedIndicator
              hasChanges={listChanged}
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
              {/* Accordion Sections */}
              <Stack gap="sm">
                {/* Resources Section */}
                <AccordionSection
                  title="Resources"
                  count={filteredResources.length}
                  isOpen={expandedSections.resources}
                  onToggle={() => toggleSection('resources')}
                >
                  <Stack gap="xs" pt="xs">
                    {filteredResources.map((resource) => (
                      <Stack key={resource.uri} gap={4}>
                        <Button
                          variant={selectedResource?.uri === resource.uri ? 'filled' : 'subtle'}
                          justify="flex-start"
                          fullWidth
                          size="sm"
                          onClick={() => setSelectedResource(resource)}
                        >
                          {resource.name || resource.uri.split('/').pop() || resource.uri}
                        </Button>
                        {/* Annotation badges */}
                        <AnnotationBadges
                          annotations={resource.annotations}
                          className="pl-sm pb-xs"
                        />
                      </Stack>
                    ))}
                  </Stack>
                </AccordionSection>

                {/* Templates Section */}
                {templates.length > 0 && (
                  <AccordionSection
                    title="Templates"
                    count={filteredTemplates.length}
                    isOpen={expandedSections.templates && filteredTemplates.length > 0}
                    onToggle={() => toggleSection('templates')}
                  >
                    <Stack gap="sm" pt="xs">
                      {filteredTemplates.map((template) => {
                        const varMatch = template.uriTemplate.match(/\{(\w+)\}/);
                        const varName = varMatch ? varMatch[1] : '';
                        return (
                          <Stack key={template.uriTemplate} gap={4}>
                            <Text size="sm" c="dimmed">{template.uriTemplate}</Text>
                            {template.description && (
                              <Text size="xs" c="dimmed">{template.description}</Text>
                            )}
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
                  </AccordionSection>
                )}

                {/* Subscriptions Section */}
                <AccordionSection
                  title="Subscriptions"
                  count={filteredSubscriptions.length}
                  isOpen={expandedSections.subscriptions && filteredSubscriptions.length > 0}
                  onToggle={() => toggleSection('subscriptions')}
                >
                  <Stack gap="xs" pt="xs">
                    {filteredSubscriptions.length === 0 ? (
                      <Text size="sm" c="dimmed">No active subscriptions</Text>
                    ) : (
                      filteredSubscriptions.map((sub) => (
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
                      ))
                    )}
                  </Stack>
                </AccordionSection>
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

            {selectedResource ? (
              <>
                <Stack gap={4}>
                  <Text size="sm">
                    <Text span c="dimmed">URI:</Text> {selectedResource.uri}
                  </Text>
                  {selectedResource.mimeType && (
                    <Text size="sm">
                      <Text span c="dimmed">MIME:</Text> {selectedResource.mimeType}
                    </Text>
                  )}
                  {selectedResource.description && (
                    <Text size="sm">
                      <Text span c="dimmed">Description:</Text> {selectedResource.description}
                    </Text>
                  )}
                </Stack>

                {/* Display annotations */}
                {selectedResource.annotations &&
                  Object.keys(selectedResource.annotations).length > 0 && (
                    <Stack gap="xs">
                      <Text size="sm" fw={500}>Annotations:</Text>
                      <Group gap="md">
                        {selectedResource.annotations.audience && (
                          <Text size="sm" c="dimmed">
                            Audience:{' '}
                            {Array.isArray(selectedResource.annotations.audience)
                              ? selectedResource.annotations.audience.join(', ')
                              : selectedResource.annotations.audience}
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
                  {isReadingResource ? (
                    <Stack align="center" py="xl">
                      <Loader size="sm" />
                      <Text size="sm" c="dimmed">Loading content...</Text>
                    </Stack>
                  ) : (
                    <Code block>
                      {resourceContent || 'No content available'}
                    </Code>
                  )}
                </ScrollArea>

                <Group justify="space-between">
                  <Group gap="sm">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (resourceContent) {
                          navigator.clipboard.writeText(resourceContent);
                        }
                      }}
                    >
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
              </>
            ) : (
              <Stack align="center" justify="center" h="200px">
                <Text c="dimmed">Select a resource to view its content</Text>
              </Stack>
            )}
          </Stack>
        </Card>
      </Grid.Col>
    </Grid>
  );
}
