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

const SubscriptionMeta = Text.withProps({
  span: true,
  c: "dimmed",
  size: "xs",
});

function formatSectionCount(label: string, count: number): string {
  return `${label} (${count})`;
}

function formatLastUpdated(lastUpdated: string): string {
  return ` — ${lastUpdated}`;
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
                        <ResourceListItem key={resource.uri} {...resource} />
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
                    {formatSectionCount("Subscriptions", subscriptions.length)}
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      {subscriptions.map((sub) => (
                        <Text key={sub.name} size="sm">
                          {sub.name}
                          {sub.lastUpdated && (
                            <SubscriptionMeta>
                              {formatLastUpdated(sub.lastUpdated)}
                            </SubscriptionMeta>
                          )}
                        </Text>
                      ))}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </Stack>
          </FullHeightCard>
        </Grid.Col>

        <Grid.Col span={8}>
          <DetailCard>
            {selectedResource ? (
              <ResourcePreviewPanel {...selectedResource} />
            ) : (
              <EmptyState>Select a resource to preview</EmptyState>
            )}
          </DetailCard>
        </Grid.Col>
      </Grid>
    </PageContainer>
  );
}
