import {
  Alert,
  Card,
  CloseButton,
  Flex,
  Group,
  Loader,
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
  ui: ResourcesUiState;
  listChanged: boolean;
  completionsSupported?: boolean;
  /**
   * Whether the connected server advertises the `resources.subscribe`
   * capability. When false, the Subscribe/Unsubscribe button and the
   * Subscriptions accordion section are hidden. Defaults to true so the
   * controls render unless a caller explicitly marks them unsupported.
   */
  subscriptionsSupported?: boolean;
  onUiChange: (next: ResourcesUiState) => void;
  onRefreshList: () => void;
  onReadResource: (uri: string) => void;
  onSubscribeResource: (uri: string) => void;
  onUnsubscribeResource: (uri: string) => void;
  onCompleteArgument?: (
    ref:
      | { type: "ref/resource"; uri: string }
      | { type: "ref/prompt"; name: string },
    argumentName: string,
    argumentValue: string,
    context: Record<string, string>,
  ) => Promise<string[]>;
  compact: boolean;
  onCompactChange: (next: boolean) => void;
}

// Selection (resource URI, template URI, the originating-template marker), the
// sidebar search, and accordion open-sections — controlled by the parent (App)
// as one object so they persist across tab navigation within a live session
// (#1417). `openSections` undefined → ResourceControls falls back to the
// compact-derived default.
export interface ResourcesUiState {
  selectedResourceUri?: string;
  selectedTemplateUri?: string;
  originatingTemplateUri?: string;
  search: string;
  openSections?: string[];
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100dvh - var(--app-shell-header-height, 0px))",
  gap: "md",
  p: "xl",
});

const Sidebar = Stack.withProps({
  w: 340,
  flex: "0 0 auto",
});

// Card that grows with its content but is capped at the screen height by the
// `sidebar` variant (`max-height: 100%`), like the Tools panel. The column
// layout lets ResourceControls' accordion take over per-section scrolling once
// the content would overflow that cap.
const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  variant: "sidebar",
});

const DetailCard = Card.withProps({
  withBorder: true,
  padding: "lg",
});

// Card that sizes to its content but caps at the screen's available
// height. When content fits, the card stays compact (footer sits right
// under the body); when content would overflow, the inner ScrollArea
// inside ResourcePreviewPanel shrinks and scrolls.
const PreviewCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  variant: "preview",
});

// Column that pins the preview card to the top of the available space
// and bounds its growth via the consumer-set `mah`. The card inside
// keeps its natural height up to that cap.
const PreviewPane = Flex.withProps({
  flex: 1,
  miw: 0,
  direction: "column",
  align: "stretch",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

const SCROLL_MAX_HEIGHT =
  "calc(100dvh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2)";

export function ResourcesScreen({
  resources,
  templates,
  subscriptions,
  readState,
  ui,
  listChanged,
  completionsSupported,
  subscriptionsSupported = true,
  onUiChange,
  onRefreshList,
  onReadResource,
  onSubscribeResource,
  onUnsubscribeResource,
  onCompleteArgument,
  compact,
  onCompactChange,
}: ResourcesScreenProps) {
  const {
    selectedResourceUri,
    selectedTemplateUri,
    originatingTemplateUri,
    search,
    openSections,
  } = ui;
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
    onUiChange({
      ...ui,
      selectedTemplateUri: undefined,
      selectedResourceUri: uri,
      originatingTemplateUri: undefined,
    });
    onReadResource(uri);
  }

  function handleSelectTemplate(uriTemplate: string) {
    onUiChange({
      ...ui,
      selectedResourceUri: undefined,
      selectedTemplateUri: uriTemplate,
      originatingTemplateUri: undefined,
    });
  }

  function handleReadResource(uri: string) {
    // Once the user reads (either from the template form or a refresh
    // inside the preview panel), hand the screen over to the preview:
    // clearing the template selection hides the template form so only
    // the rendered resource is shown. We remember the template URI so
    // closing the preview can restore the form.
    onUiChange({
      ...ui,
      originatingTemplateUri: selectedTemplateUri ?? originatingTemplateUri,
      selectedTemplateUri: undefined,
      selectedResourceUri: uri,
    });
    onReadResource(uri);
  }

  function handleClosePreview() {
    if (originatingTemplateUri) {
      onUiChange({
        ...ui,
        selectedResourceUri: undefined,
        selectedTemplateUri: originatingTemplateUri,
        originatingTemplateUri: undefined,
      });
    } else {
      onUiChange({ ...ui, selectedResourceUri: undefined });
    }
  }

  function renderReadState() {
    if (!readState) return null;

    if (readState.status === "pending") {
      return (
        <PreviewCard>
          <Stack gap="md">
            <Group justify="flex-start">
              <CloseButton
                aria-label="Close preview"
                onClick={handleClosePreview}
              />
            </Group>
            <Stack align="center" py="xl">
              <Loader size="sm" />
              <Text c="dimmed">Reading resource...</Text>
            </Stack>
          </Stack>
        </PreviewCard>
      );
    }

    if (readState.status === "error") {
      return (
        <PreviewCard>
          <Stack gap="md">
            <Group justify="flex-start">
              <CloseButton
                aria-label="Close preview"
                onClick={handleClosePreview}
              />
            </Group>
            <Alert color="red" variant="light" title="Read Error">
              {readState.error ?? "Failed to read resource"}
            </Alert>
          </Stack>
        </PreviewCard>
      );
    }

    if (readState.result && readResource) {
      return (
        <PreviewCard>
          <ResourcePreviewPanel
            resource={readResource}
            contents={readState.result.contents}
            lastUpdated={readState.lastUpdated}
            isSubscribed={readState.isSubscribed ?? false}
            subscriptionsSupported={subscriptionsSupported}
            onRefresh={() => handleReadResource(readResource.uri)}
            onSubscribe={() => onSubscribeResource(readResource.uri)}
            onUnsubscribe={() => onUnsubscribeResource(readResource.uri)}
            onClose={handleClosePreview}
          />
        </PreviewCard>
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
            subscriptionsSupported={subscriptionsSupported}
            selectedUri={selectedResourceUri}
            selectedTemplateUri={selectedTemplateUri}
            searchText={search}
            openSections={openSections}
            listChanged={listChanged}
            onRefreshList={onRefreshList}
            onSearchChange={(value) => onUiChange({ ...ui, search: value })}
            onOpenSectionsChange={(value) =>
              onUiChange({ ...ui, openSections: value })
            }
            onSelectUri={handleSelectResource}
            onSelectTemplate={handleSelectTemplate}
            onUnsubscribeResource={onUnsubscribeResource}
            compact={compact}
            onCompactChange={onCompactChange}
          />
        </SidebarCard>
      </Sidebar>

      {selectedTemplate ? (
        // Template form only — once the user clicks Read Resource,
        // handleReadResource clears the template selection so the
        // resource branch takes over and the preview is shown alone.
        // maw=40% keeps the form from stretching across the whole
        // main area; an unconstrained text input + Read button at
        // viewport width looks weird, especially on wide displays.
        <PreviewPane mah={SCROLL_MAX_HEIGHT} maw="40%">
          <PreviewCard>
            <ResourceTemplatePanel
              template={selectedTemplate}
              onReadResource={handleReadResource}
              completionsSupported={completionsSupported}
              onCompleteArgument={
                onCompleteArgument
                  ? (argName, value, context) =>
                      onCompleteArgument(
                        {
                          type: "ref/resource",
                          uri: selectedTemplate.uriTemplate,
                        },
                        argName,
                        value,
                        context,
                      )
                  : undefined
              }
            />
          </PreviewCard>
        </PreviewPane>
      ) : readResource ? (
        // Sized-to-content preview pane, capped at the screen's available
        // height. When the resource body fits, the card hugs its content
        // and the subscribe/refresh row sits right under it. When the body
        // would overflow, the inner ScrollArea inside ResourcePreviewPanel
        // shrinks and scrolls, keeping the footer pinned at the cap.
        // miw=0 prevents wide content (long unbroken lines, tables) from
        // pushing the pane past the viewport's right edge.
        <PreviewPane mah={SCROLL_MAX_HEIGHT}>{renderReadState()}</PreviewPane>
      ) : (
        <DetailCard flex={1}>
          <EmptyState>Select a resource to preview</EmptyState>
        </DetailCard>
      )}
    </ScreenLayout>
  );
}
