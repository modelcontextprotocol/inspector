import {
  Alert,
  Card,
  Flex,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import type {
  ReadResourceResult,
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";
import type { InspectorResourceSubscription } from "../../../../../../core/mcp/types.js";
import { ResourceControls } from "../../groups/ResourceControls/ResourceControls";
import { ResourcePreviewPanel } from "../../groups/ResourcePreviewPanel/ResourcePreviewPanel";
import { ResourceTemplatePanel } from "../../groups/ResourceTemplatePanel/ResourceTemplatePanel";

export interface ReadResourceState {
  status: "idle" | "pending" | "ok" | "error";
  uri?: string;
  result?: ReadResourceResult;
  error?: string;
  lastUpdated?: Date;
  isSubscribed?: boolean;
}

export interface ResourcesScreenProps {
  resources: Resource[];
  templates: ResourceTemplate[];
  subscriptions: InspectorResourceSubscription[];
  selectedResourceUri?: string;
  selectedTemplateUri?: string;
  readState?: ReadResourceState;
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

const SCROLL_MAX_HEIGHT =
  "calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2)";

export function ResourcesScreen({
  resources,
  templates,
  subscriptions,
  selectedResourceUri,
  selectedTemplateUri,
  readState,
  listChanged,
  onRefreshList,
  onSelectUri,
  onSelectTemplate,
  onReadResource,
  onSubscribeResource,
  onUnsubscribeResource,
}: ResourcesScreenProps) {
  const selectedResource = selectedResourceUri
    ? resources.find((r) => r.uri === selectedResourceUri)
    : undefined;
  const selectedTemplate = selectedTemplateUri
    ? templates.find((t) => t.uriTemplate === selectedTemplateUri)
    : undefined;

  function renderReadState() {
    if (!readState) return null;

    if (readState.status === "pending") {
      return (
        <DetailCard>
          <Stack align="center" py="xl">
            <Loader size="sm" />
            <Text c="dimmed">Reading resource...</Text>
          </Stack>
        </DetailCard>
      );
    }

    if (readState.status === "error") {
      return (
        <DetailCard>
          <Alert color="red" variant="light" title="Read Error">
            {readState.error ?? "Failed to read resource"}
          </Alert>
        </DetailCard>
      );
    }

    if (readState.result && selectedResource) {
      return (
        <DetailCard>
          <ResourcePreviewPanel
            resource={selectedResource}
            contents={readState.result.contents}
            lastUpdated={readState.lastUpdated}
            isSubscribed={readState.isSubscribed ?? false}
            onRefresh={() => onReadResource(selectedResource.uri)}
            onSubscribe={() => onSubscribeResource(selectedResource.uri)}
            onUnsubscribe={() => onUnsubscribeResource(selectedResource.uri)}
          />
        </DetailCard>
      );
    }

    return null;
  }

  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <ResourceControls
            resources={resources}
            templates={templates}
            subscriptions={subscriptions}
            selectedUri={selectedResourceUri}
            selectedTemplate={selectedTemplateUri}
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
          <ScrollArea.Autosize flex={1} mah={SCROLL_MAX_HEIGHT}>
            <DetailCard>
              <ResourceTemplatePanel
                template={selectedTemplate}
                onReadResource={onReadResource}
              />
            </DetailCard>
          </ScrollArea.Autosize>
          <ScrollArea.Autosize flex={1} mah={SCROLL_MAX_HEIGHT}>
            {renderReadState() ?? (
              <DetailCard>
                <EmptyState>Enter a URI and click Read to preview</EmptyState>
              </DetailCard>
            )}
          </ScrollArea.Autosize>
        </Group>
      ) : selectedResource ? (
        <ScrollArea.Autosize flex={1} mah={SCROLL_MAX_HEIGHT}>
          {renderReadState() ?? (
            <DetailCard>
              <EmptyState>Click to read this resource</EmptyState>
            </DetailCard>
          )}
        </ScrollArea.Autosize>
      ) : (
        <DetailCard flex={1}>
          <EmptyState>Select a resource to preview</EmptyState>
        </DetailCard>
      )}
    </ScreenLayout>
  );
}
