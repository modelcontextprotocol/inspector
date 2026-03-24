import {
  Accordion,
  Card,
  Container,
  Grid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { ListChangedIndicator } from "../../atoms/ListChangedIndicator/ListChangedIndicator";
import { ResourceListItem } from "../../molecules/ResourceListItem/ResourceListItem";
import { ResourcePreviewPanel } from "../../molecules/ResourcePreviewPanel/ResourcePreviewPanel";
import { ResourceTemplateInput } from "../../molecules/ResourceTemplateInput/ResourceTemplateInput";
import type { ResourceListItemProps } from "../../molecules/ResourceListItem/ResourceListItem";
import type { ResourcePreviewPanelProps } from "../../molecules/ResourcePreviewPanel/ResourcePreviewPanel";
import type { ResourceTemplateInputProps } from "../../molecules/ResourceTemplateInput/ResourceTemplateInput";

export interface SubscriptionInfo {
  name: string;
  lastUpdated?: string;
}

export interface ResourcesScreenProps {
  resources: ResourceListItemProps[];
  templates: ResourceTemplateInputProps[];
  subscriptions: SubscriptionInfo[];
  selectedResource?: ResourcePreviewPanelProps;
  listChanged: boolean;
  searchText: string;
  onSearchChange: (text: string) => void;
  onRefreshList: () => void;
  onSelectResource: (uri: string) => void;
}

export function ResourcesScreen({
  resources,
  templates,
  subscriptions,
  selectedResource,
  listChanged,
  searchText,
  onSearchChange,
  onRefreshList,
}: ResourcesScreenProps) {
  const filteredResources = resources.filter((r) =>
    r.name.toLowerCase().includes(searchText.toLowerCase()),
  );

  const openSections = [
    ...(filteredResources.length > 0 ? ["resources"] : []),
    ...(templates.length > 0 ? ["templates"] : []),
    ...(subscriptions.length > 0 ? ["subscriptions"] : []),
  ];

  return (
    <Container size="xl" py="xl">
      <Grid align="stretch">
        <Grid.Col span={4}>
          <Card withBorder padding="lg" h="100%">
            <Stack gap="sm">
              <Title order={4}>Resources</Title>
              <ListChangedIndicator
                visible={listChanged}
                onRefresh={onRefreshList}
              />
              <TextInput
                placeholder="Search..."
                value={searchText}
                onChange={(e) => onSearchChange(e.currentTarget.value)}
              />
              <Accordion multiple defaultValue={openSections}>
                <Accordion.Item value="resources">
                  <Accordion.Control disabled={filteredResources.length === 0}>
                    URIs ({filteredResources.length})
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      {filteredResources.map((resource) => (
                        <ResourceListItem key={resource.uri} {...resource} />
                      ))}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>

                <Accordion.Item value="templates">
                  <Accordion.Control disabled={templates.length === 0}>
                    Templates ({templates.length})
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      {templates.map((template) => (
                        <ResourceTemplateInput
                          key={template.template}
                          {...template}
                        />
                      ))}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>

                <Accordion.Item value="subscriptions">
                  <Accordion.Control disabled={subscriptions.length === 0}>
                    Subscriptions ({subscriptions.length})
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      {subscriptions.map((sub) => (
                        <Text key={sub.name} size="sm">
                          {sub.name}
                          {sub.lastUpdated && (
                            <Text span c="dimmed" size="xs">
                              {" "}
                              — {sub.lastUpdated}
                            </Text>
                          )}
                        </Text>
                      ))}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={8}>
          <Card withBorder padding="lg">
            {selectedResource ? (
              <ResourcePreviewPanel {...selectedResource} />
            ) : (
              <Text c="dimmed" ta="center" py="xl">
                Select a resource to preview
              </Text>
            )}
          </Card>
        </Grid.Col>
      </Grid>
    </Container>
  );
}
