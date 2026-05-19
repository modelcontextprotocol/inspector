import { useState } from "react";
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
  readState?: ReadResourceState;
  listChanged: boolean;
  onRefreshList: () => void;
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

// Same as DetailCard but stretched to fill its parent's height. Used in
// the preview pane so the ResourcePreviewPanel can pin its header/footer
// to the card's edges while the content scrolls in the middle.
const FillDetailCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  h: "100%",
});

// Fixed-height column that hosts the FillDetailCard. Replaces the prior
// ScrollArea.Autosize wrapping so the panel's internal scroll region —
// not the whole card — handles overflow.
const PreviewPane = Flex.withProps({
  flex: 1,
  miw: 0,
  direction: "column",
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
  readState,
  listChanged,
  onRefreshList,
  onReadResource,
  onSubscribeResource,
  onUnsubscribeResource,
}: ResourcesScreenProps) {
  const [selectedResourceUri, setSelectedResourceUri] = useState<
    string | undefined
  >(undefined);
  const [selectedTemplateUri, setSelectedTemplateUri] = useState<
    string | undefined
  >(undefined);

  const selectedResource = selectedResourceUri
    ? resources.find((r) => r.uri === selectedResourceUri)
    : undefined;
  const selectedTemplate = selectedTemplateUri
    ? templates.find((t) => t.uriTemplate === selectedTemplateUri)
    : undefined;

  // For template-expanded URIs that don't appear in the resources list,
  // construct a synthetic Resource so the preview panel can render.
  const readResource: Resource | undefined =
    selectedResource ??
    (readState?.uri && readState.uri === selectedResourceUri
      ? { name: readState.uri, uri: readState.uri }
      : undefined);

  function handleSelectResource(uri: string) {
    setSelectedTemplateUri(undefined);
    setSelectedResourceUri(uri);
    onReadResource(uri);
  }

  function handleSelectTemplate(uriTemplate: string) {
    setSelectedResourceUri(undefined);
    setSelectedTemplateUri(uriTemplate);
  }

  function handleReadResource(uri: string) {
    setSelectedResourceUri(uri);
    onReadResource(uri);
  }

  function renderReadState() {
    if (!readState) return null;

    if (readState.status === "pending") {
      return (
        <FillDetailCard>
          <Stack align="center" py="xl">
            <Loader size="sm" />
            <Text c="dimmed">Reading resource...</Text>
          </Stack>
        </FillDetailCard>
      );
    }

    if (readState.status === "error") {
      return (
        <FillDetailCard>
          <Alert color="red" variant="light" title="Read Error">
            {readState.error ?? "Failed to read resource"}
          </Alert>
        </FillDetailCard>
      );
    }

    if (readState.result && readResource) {
      return (
        <FillDetailCard>
          <ResourcePreviewPanel
            resource={readResource}
            contents={readState.result.contents}
            lastUpdated={readState.lastUpdated}
            isSubscribed={readState.isSubscribed ?? false}
            onRefresh={() => handleReadResource(readResource.uri)}
            onSubscribe={() => onSubscribeResource(readResource.uri)}
            onUnsubscribe={() => onUnsubscribeResource(readResource.uri)}
          />
        </FillDetailCard>
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
            selectedTemplateUri={selectedTemplateUri}
            listChanged={listChanged}
            onRefreshList={onRefreshList}
            onSelectUri={handleSelectResource}
            onSelectTemplate={handleSelectTemplate}
            onUnsubscribeResource={onUnsubscribeResource}
          />
        </SidebarCard>
      </Sidebar>

      {selectedTemplate ? (
        <Group
          flex={1}
          miw={0}
          mah={SCROLL_MAX_HEIGHT}
          gap="md"
          align="stretch"
          wrap="nowrap"
        >
          <ScrollArea.Autosize flex={1} miw={0} mah={SCROLL_MAX_HEIGHT}>
            <DetailCard>
              <ResourceTemplatePanel
                template={selectedTemplate}
                onReadResource={handleReadResource}
              />
            </DetailCard>
          </ScrollArea.Autosize>
          <PreviewPane>
            {renderReadState() ?? (
              <FillDetailCard>
                <EmptyState>Enter a URI and click Read to preview</EmptyState>
              </FillDetailCard>
            )}
          </PreviewPane>
        </Group>
      ) : selectedResource ? (
        // Fixed-height column lets the preview panel pin its header and
        // subscribe/refresh footer to the card's edges while the resource
        // body scrolls inside the panel. miw=0 prevents wide content
        // (long unbroken lines, tables) from pushing the pane past the
        // viewport's right edge.
        <PreviewPane mah={SCROLL_MAX_HEIGHT}>{renderReadState()}</PreviewPane>
      ) : (
        <DetailCard flex={1}>
          <EmptyState>Select a resource to preview</EmptyState>
        </DetailCard>
      )}
    </ScreenLayout>
  );
}
