import { Accordion, Grid, Paper, Stack, Text, TextInput } from "@mantine/core";
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

  return (
    <Grid>
      <Grid.Col span={4}>
        <Paper withBorder p="md">
          <Stack gap="sm">
            <ListChangedIndicator
              visible={listChanged}
              onRefresh={onRefreshList}
            />
            <TextInput
              placeholder="Search..."
              value={searchText}
              onChange={(e) => onSearchChange(e.currentTarget.value)}
            />
            <Accordion
              multiple
              defaultValue={["resources", "templates", "subscriptions"]}
            >
              <Accordion.Item value="resources">
                <Accordion.Control>
                  Resources ({filteredResources.length})
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
                <Accordion.Control>
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
                <Accordion.Control>
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
        </Paper>
      </Grid.Col>

      <Grid.Col span={8}>
        <Paper withBorder p="md">
          {selectedResource ? (
            <ResourcePreviewPanel {...selectedResource} />
          ) : (
            <Text c="dimmed" ta="center" py="xl">
              Select a resource to preview
            </Text>
          )}
        </Paper>
      </Grid.Col>
    </Grid>
  );
}
