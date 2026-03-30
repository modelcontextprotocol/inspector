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
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { ResourceListItem } from "../../groups/ResourceListItem/ResourceListItem";
import { ResourcePreviewPanel } from "../../groups/ResourcePreviewPanel/ResourcePreviewPanel";
import { ResourceSubscribedItem } from "../../groups/ResourceSubscribedItem/ResourceSubscribedItem";
import { ResourceTemplatePanel } from "../../groups/ResourceTemplatePanel/ResourceTemplatePanel";

export interface ResourceItem {
  name: string;
  uri: string;
  annotations?: { audience?: string; priority?: number };
  selected: boolean;
}

export interface TemplateListItem {
  name: string;
  title?: string;
  uriTemplate: string;
  selected: boolean;
}

export interface SubscriptionItem {
  name: string;
  uri: string;
  lastUpdated?: string;
}

export interface SelectedResource {
  uri: string;
  mimeType: string;
  annotations?: { audience?: string; priority?: number };
  content: string;
  lastUpdated?: string;
  isSubscribed: boolean;
}

export interface SelectedTemplate {
  name: string;
  title?: string;
  uriTemplate: string;
  description?: string;
  annotations?: { audience?: string; priority?: number };
}

export interface ResourcesScreenProps {
  resources: ResourceItem[];
  templates: TemplateListItem[];
  subscriptions: SubscriptionItem[];
  selectedResource?: SelectedResource;
  selectedTemplate?: SelectedTemplate;
  listChanged: boolean;
  searchText: string;
  onSearchChange: (text: string) => void;
  onRefreshList: () => void;
  onSelectUri: (uri: string) => void;
  onSelectTemplate: (uriTemplate: string) => void;
  onReadResource: (uri: string) => void;
  onSubscribeResource: (uri: string) => void;
  onUnsubscribeResource: (uri: string) => void;
}

const PageContainer = Container.withProps({
  size: "xl",
  py: "xl",
});

const FullHeightCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  h: "100%",
});

const DetailCard = Card.withProps({
  withBorder: true,
  padding: "lg",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

function formatSectionCount(label: string, count: number): string {
  return `${label} (${count})`;
}

function templateDisplayName(item: TemplateListItem): string {
  return item.title ?? item.name;
}

export function ResourcesScreen({
  resources,
  templates,
  subscriptions,
  selectedResource,
  selectedTemplate,
  listChanged,
  searchText,
  onSearchChange,
  onRefreshList,
  onSelectUri,
  onSelectTemplate,
  onReadResource,
  onSubscribeResource,
  onUnsubscribeResource,
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
    <PageContainer>
      <Grid align="stretch">
        <Grid.Col span={4}>
          <FullHeightCard>
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
                    {formatSectionCount("URIs", filteredResources.length)}
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      {filteredResources.map((resource) => (
                        <ResourceListItem
                          key={resource.uri}
                          name={resource.name}
                          uri={resource.uri}
                          annotations={resource.annotations}
                          selected={resource.selected}
                          onClick={() => onSelectUri(resource.uri)}
                        />
                      ))}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>

                <Accordion.Item value="templates">
                  <Accordion.Control disabled={templates.length === 0}>
                    {formatSectionCount("Templates", templates.length)}
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      {templates.map((template) => (
                        <ResourceListItem
                          key={template.uriTemplate}
                          name={templateDisplayName(template)}
                          uri={template.uriTemplate}
                          selected={template.selected}
                          onClick={() => onSelectTemplate(template.uriTemplate)}
                        />
                      ))}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>

                <Accordion.Item value="subscriptions">
                  <Accordion.Control disabled={subscriptions.length === 0}>
                    {formatSectionCount("Subscriptions", subscriptions.length)}
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      {subscriptions.map((sub) => (
                        <ResourceSubscribedItem
                          key={sub.name}
                          name={sub.name}
                          lastUpdated={sub.lastUpdated}
                          onUnsubscribe={() => onUnsubscribeResource(sub.uri)}
                        />
                      ))}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </Stack>
          </FullHeightCard>
        </Grid.Col>

        <Grid.Col span={8}>
          <Stack gap="md">
            {selectedTemplate ? (
              <>
                <DetailCard>
                  <ResourceTemplatePanel
                    {...selectedTemplate}
                    onReadResource={onReadResource}
                  />
                </DetailCard>
                {selectedResource && (
                  <DetailCard>
                    <ResourcePreviewPanel
                      {...selectedResource}
                      onRefresh={() => onReadResource(selectedResource.uri)}
                      onSubscribe={() =>
                        onSubscribeResource(selectedResource.uri)
                      }
                      onUnsubscribe={() =>
                        onUnsubscribeResource(selectedResource.uri)
                      }
                    />
                  </DetailCard>
                )}
              </>
            ) : selectedResource ? (
              <DetailCard>
                <ResourcePreviewPanel
                  {...selectedResource}
                  onRefresh={() => onReadResource(selectedResource.uri)}
                  onSubscribe={() => onSubscribeResource(selectedResource.uri)}
                  onUnsubscribe={() =>
                    onUnsubscribeResource(selectedResource.uri)
                  }
                />
              </DetailCard>
            ) : (
              <DetailCard>
                <EmptyState>Select a resource to preview</EmptyState>
              </DetailCard>
            )}
          </Stack>
        </Grid.Col>
      </Grid>
    </PageContainer>
  );
}
