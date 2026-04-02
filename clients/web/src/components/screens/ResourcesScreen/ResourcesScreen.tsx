import { Card, Flex, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { ResourceControls } from "../../groups/ResourceControls/ResourceControls";
import { ResourcePreviewPanel } from "../../groups/ResourcePreviewPanel/ResourcePreviewPanel";
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
  onRefreshList: () => void;
  onSelectUri: (uri: string) => void;
  onSelectTemplate: (uriTemplate: string) => void;
  onReadResource: (uri: string) => void;
  onSubscribeResource: (uri: string) => void;
  onUnsubscribeResource: (uri: string) => void;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100vh - var(--app-shell-header-height, 0px))",
  gap: "md",
  p: "xl",
});

const Sidebar = Stack.withProps({
  w: 340,
  flex: "0 0 auto",
});

const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
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

export function ResourcesScreen({
  resources,
  templates,
  subscriptions,
  selectedResource,
  selectedTemplate,
  listChanged,
  onRefreshList,
  onSelectUri,
  onSelectTemplate,
  onReadResource,
  onSubscribeResource,
  onUnsubscribeResource,
}: ResourcesScreenProps) {
  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <ResourceControls
            resources={resources}
            templates={templates}
            subscriptions={subscriptions}
            listChanged={listChanged}
            onRefreshList={onRefreshList}
            onSelectUri={onSelectUri}
            onSelectTemplate={onSelectTemplate}
            onUnsubscribeResource={onUnsubscribeResource}
          />
        </SidebarCard>
      </Sidebar>

      {selectedTemplate ? (
        <Group flex={1} gap="md" align="flex-start" wrap="nowrap">
          <ScrollArea.Autosize
            flex={1}
            mah="calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2)"
          >
            <DetailCard>
              <ResourceTemplatePanel
                {...selectedTemplate}
                onReadResource={onReadResource}
              />
            </DetailCard>
          </ScrollArea.Autosize>
          <ScrollArea.Autosize
            flex={1}
            mah="calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2)"
          >
            {selectedResource ? (
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
            ) : (
              <DetailCard>
                <EmptyState>
                  Enter a URI and click Read to preview
                </EmptyState>
              </DetailCard>
            )}
          </ScrollArea.Autosize>
        </Group>
      ) : selectedResource ? (
        <ScrollArea.Autosize
          flex={1}
          mah="calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2)"
        >
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
        </ScrollArea.Autosize>
      ) : (
        <DetailCard flex={1}>
          <EmptyState>Select a resource to preview</EmptyState>
        </DetailCard>
      )}
    </ScreenLayout>
  );
}
