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
  Collapse,
  UnstyledButton,
  Paper,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { ListChangedIndicator } from '../components/ListChangedIndicator';
import { AnnotationBadges, getPriorityLabel } from '../components/AnnotationBadges';
import {
  mockResources,
  mockTemplates,
  mockSubscriptions,
  type Resource,
  type ResourceTemplate,
  type Subscription,
} from '@/mocks';

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
  const [hasResourcesChanged, setHasResourcesChanged] = useState(true);
  const [selectedResource, setSelectedResource] = useState<Resource>(mockResources[0]);
  const [searchFilter, setSearchFilter] = useState('');
  const [templateInputs, setTemplateInputs] = useState<Record<string, string>>({});
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(mockSubscriptions);

  // Accordion state - Resources expanded by default, others collapsed
  const [expandedSections, setExpandedSections] = useState({
    resources: true,
    templates: false,
    subscriptions: false,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

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

  // Filter all sections based on search
  const filteredResources = mockResources.filter((resource) =>
    resource.uri.toLowerCase().includes(searchFilter.toLowerCase())
  );
  const filteredTemplates = mockTemplates.filter(
    (t) =>
      t.uriTemplate.toLowerCase().includes(searchFilter.toLowerCase()) ||
      t.description.toLowerCase().includes(searchFilter.toLowerCase())
  );
  const filteredSubscriptions = subscriptions.filter((s) =>
    s.uri.toLowerCase().includes(searchFilter.toLowerCase())
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
                          variant={selectedResource.uri === resource.uri ? 'filled' : 'subtle'}
                          justify="flex-start"
                          fullWidth
                          size="sm"
                          onClick={() => setSelectedResource(resource)}
                        >
                          {resource.uri.split('/').pop()}
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
