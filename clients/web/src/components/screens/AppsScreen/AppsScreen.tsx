import { useRef, useState, type Ref } from "react";
import {
  ActionIcon,
  Button,
  Card,
  Flex,
  Group,
  Image,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  MdArrowBack,
  MdClose,
  MdFullscreen,
  MdFullscreenExit,
} from "react-icons/md";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type {
  AppBridgeEventMap,
  McpUiDisplayMode,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  AppRenderer,
  type AppRendererHandle,
  type BridgeFactory,
} from "../../elements/AppRenderer/AppRenderer";
import { HOST_AVAILABLE_DISPLAY_MODES } from "../../elements/AppRenderer/createAppBridgeFactory";
import { AppDetailPanel } from "../../groups/AppDetailPanel/AppDetailPanel";
import { AppControls } from "../../groups/AppControls/AppControls";
import { hasInputFields, resolveDisplayLabel } from "../../../utils/toolUtils";
import { collectSchemaDefaults } from "../../../utils/jsonUtils";

export interface AppsScreenProps {
  tools: Tool[];
  listChanged: boolean;
  /**
   * URL of the inspector's sandbox proxy page (the trusted outer iframe). When
   * undefined, MCP Apps cannot run (legacy backend, or a build without the
   * sandbox controller) and the screen renders an unavailable state instead of
   * a silently blank iframe.
   */
  sandboxPath?: string;
  bridgeFactory: BridgeFactory;
  rendererRef: Ref<AppRendererHandle>;
  ui: AppsUiState;
  onUiChange: (next: AppsUiState) => void;
  onRefreshList: () => void;
  onSelectApp: (name: string) => void;
  onOpenApp: (name: string, args: Record<string, unknown>) => void;
  onCloseApp: () => void;
  /** Surfaces bridge/runtime failures from the renderer (e.g. no client). */
  onError?: (err: Error) => void;
}

// Selected app, its form values, and the sidebar search — controlled by the
// parent (App) as one object so they persist across tab navigation within a
// live session (#1417). `running`/`maximized` stay local to the screen: they're
// tied to the live iframe and bridge, which are torn down on unmount, so
// persisting them would restore a flag without its runtime. On return the
// selected app's input form (with its values) is shown, ready to re-open.
export interface AppsUiState {
  selectedAppName?: string;
  formValues: Record<string, unknown>;
  search: string;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100dvh - var(--app-shell-header-height, 0px))",
  gap: "md",
  p: "xl",
  align: "flex-start",
});

const Sidebar = Stack.withProps({
  w: 340,
  flex: "0 0 auto",
});

const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
});

// `variant="preview"` (overflow: hidden) keeps the full-height card from
// bleeding past the viewport: the running app's iframe fills it, and the
// app-input form scrolls internally (see AppDetailPanel's PanelScroll).
const ContentCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  variant: "preview",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
  gap: "sm",
});

const HeaderLabel = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
  align: "center",
  flex: 1,
  miw: 0,
});

const HeaderIcon = Image.withProps({
  w: 24,
  h: 24,
  fit: "contain",
});

const HeaderTitle = Text.withProps({
  fw: 600,
  size: "lg",
  truncate: true,
  flex: 1,
  miw: 0,
});

const HeaderActions = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
});

// The host-controlled box the running app sits within. Its size is driven by
// the host's layout (window resize, sidebar toggle, maximize) and NOT by the
// view's reported content height — that drives the inner RendererFrame — so the
// renderer's containerDimensions observer can measure this element without
// coupling host→view container size to view→host size-changed.
const RendererContainer = Stack.withProps({
  flex: 1,
  miw: 0,
  mih: 0,
  gap: 0,
});

// The inner box that actually holds the iframe. Sized by the view-reported
// content height (see `contentHeight`) and capped at the outer container.
// Distinct from RendererContainer above so the two roles read clearly in JSX.
const RendererFrame = Stack.withProps({
  miw: 0,
  mih: 0,
  gap: 0,
});

const ContentStack = Stack.withProps({
  gap: "md",
  h: "100%",
});

export function AppsScreen({
  tools,
  listChanged,
  sandboxPath,
  bridgeFactory,
  rendererRef,
  ui,
  onUiChange,
  onRefreshList,
  onSelectApp,
  onOpenApp,
  onCloseApp,
  onError,
}: AppsScreenProps) {
  const { selectedAppName, formValues, search } = ui;
  const [running, setRunning] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const rendererContainerRef = useRef<HTMLDivElement | null>(null);
  // Height (px) the running view last reported via ui/notifications/size-changed.
  // Undefined until the view reports (or after it's torn down), in which case
  // the iframe fills the available card space as before. Local to the screen
  // like `running`/`maximized`: it's tied to the live iframe, not persisted.
  const [appHeight, setAppHeight] = useState<number | undefined>(undefined);

  const selectedTool = selectedAppName
    ? tools.find((t) => t.name === selectedAppName)
    : undefined;
  const selectedHasFields = selectedTool ? hasInputFields(selectedTool) : false;

  // The running view reports its rendered content height via
  // ui/notifications/size-changed; honor it so the iframe is neither clipped
  // nor surrounded by dead space. Width is left at the host-controlled
  // container width. The value is clamped to the available space by the
  // renderer frame's `mah` below, and ignored while maximized (the app fills
  // the screen instead). A non-positive height is ignored — a view's
  // ResizeObserver can transiently fire 0 before layout settles or during
  // teardown, which would otherwise collapse the frame (mirrors AppRenderer's
  // own 0×0 skip on the container side).
  function handleSizeChange(size: AppBridgeEventMap["sizechange"]) {
    if (size.height != null && size.height > 0) setAppHeight(size.height);
  }

  // The app's display mode is derived from the existing maximized toggle.
  // Passed to AppRenderer so the running view receives it via
  // host-context-changed; the Maximize/Restore button below keeps toggling
  // `maximized`, which now flows out as a protocol event.
  const displayMode: McpUiDisplayMode = maximized ? "fullscreen" : "inline";

  // Handle a view-originated ui/request-display-mode. Only modes the inspector
  // advertises in `availableDisplayModes` are honored — an unsupported request
  // (e.g. "pip") is declined by returning the current mode, per spec.
  function handleRequestDisplayMode(
    requested: McpUiDisplayMode,
  ): McpUiDisplayMode {
    if (!HOST_AVAILABLE_DISPLAY_MODES.includes(requested)) return displayMode;
    setMaximized(requested === "fullscreen");
    return requested;
  }

  function handleSelect(name: string) {
    if (name === selectedAppName) return;
    const next = tools.find((t) => t.name === name);
    if (!next) return;
    // Seed schema defaults so default-only fields are sent on Open App (parity
    // with the form's resolveValue display, which onChange doesn't capture).
    onUiChange({
      ...ui,
      selectedAppName: name,
      formValues: collectSchemaDefaults(next.inputSchema),
    });
    setMaximized(false);
    setAppHeight(undefined);
    onSelectApp(name);
    // No-input apps auto-launch on selection so the user lands directly in
    // the running view; apps with fields wait for the explicit Open App click.
    if (!hasInputFields(next)) {
      setRunning(true);
      onOpenApp(name, {});
    } else {
      setRunning(false);
    }
  }

  function handleOpen() {
    if (!selectedTool) return;
    setAppHeight(undefined);
    setRunning(true);
    onOpenApp(selectedTool.name, formValues);
  }

  function handleClose() {
    setRunning(false);
    onUiChange({ ...ui, selectedAppName: undefined, formValues: {} });
    setMaximized(false);
    setAppHeight(undefined);
    onCloseApp();
  }

  function handleBackToInput() {
    setRunning(false);
    setMaximized(false);
    setAppHeight(undefined);
  }

  // No sandbox proxy URL means the host can't embed the trusted outer iframe
  // the double-iframe sandbox depends on — surface that plainly instead of
  // mounting an iframe that would render blank.
  if (!sandboxPath) {
    return (
      <ScreenLayout>
        <ContentCard flex={1} h="100%">
          <EmptyState>
            MCP Apps are unavailable — the sandbox could not be reached.
          </EmptyState>
        </ContentCard>
      </ScreenLayout>
    );
  }

  // While maximized the app fills the screen, so the view-reported height is
  // ignored; otherwise we honor it (clamped to the card by the frame's `mah`).
  // `appHeight` is intentionally NOT cleared when toggling maximize: carrying
  // the last inline height across a maximize→restore means the frame restores
  // at its prior size immediately, rather than flashing to full-card height
  // (flex:1) for the frame or two until the view sends a fresh size-changed
  // after the `inline` host-context-changed.
  const contentHeight = maximized ? undefined : appHeight;

  return (
    <ScreenLayout>
      {!maximized && (
        <Sidebar>
          <SidebarCard>
            <AppControls
              tools={tools}
              selectedName={selectedAppName}
              searchText={search}
              listChanged={listChanged}
              onRefreshList={onRefreshList}
              onSearchChange={(value) => onUiChange({ ...ui, search: value })}
              onSelectApp={handleSelect}
            />
          </SidebarCard>
        </Sidebar>
      )}

      <ContentCard flex={1} h="100%">
        {selectedTool ? (
          <ContentStack>
            <HeaderRow>
              <HeaderLabel>
                {selectedTool.icons?.[0]?.src && (
                  <HeaderIcon src={selectedTool.icons[0].src} alt="" />
                )}
                <HeaderTitle>
                  {resolveDisplayLabel(selectedTool.name, selectedTool.title)}
                </HeaderTitle>
              </HeaderLabel>
              <HeaderActions>
                {running && selectedHasFields && (
                  <Button
                    variant="subtle"
                    size="sm"
                    leftSection={<MdArrowBack aria-hidden size={16} />}
                    onClick={handleBackToInput}
                  >
                    Back to Input
                  </Button>
                )}
                {running && (
                  <Tooltip label={maximized ? "Restore" : "Maximize"}>
                    <ActionIcon
                      variant="subtle"
                      onClick={() => setMaximized((m) => !m)}
                      aria-label={maximized ? "Restore" : "Maximize"}
                    >
                      {maximized ? (
                        <MdFullscreenExit aria-hidden size={20} />
                      ) : (
                        <MdFullscreen aria-hidden size={20} />
                      )}
                    </ActionIcon>
                  </Tooltip>
                )}
                <Tooltip label="Close">
                  <ActionIcon
                    variant="subtle"
                    onClick={handleClose}
                    aria-label="Close"
                  >
                    <MdClose aria-hidden size={20} />
                  </ActionIcon>
                </Tooltip>
              </HeaderActions>
            </HeaderRow>
            {running ? (
              // RendererContainer is the host-controlled box (its size only
              // changes with host layout); the inner RendererFrame is sized by
              // the view's reported content height, capped at the container.
              <RendererContainer ref={rendererContainerRef}>
                <RendererFrame
                  flex={contentHeight != null ? "0 0 auto" : 1}
                  h={contentHeight}
                  mah="100%"
                >
                  {/* Keying by name forces the renderer to remount when the
                      selected app changes, ensuring a fresh bridge and iframe
                      rather than reusing the previous app's transport. */}
                  <AppRenderer
                    key={selectedTool.name}
                    sandboxPath={sandboxPath}
                    tool={selectedTool}
                    bridgeFactory={bridgeFactory}
                    onError={onError}
                    onSizeChange={handleSizeChange}
                    displayMode={displayMode}
                    onRequestDisplayMode={handleRequestDisplayMode}
                    containerRef={rendererContainerRef}
                    ref={rendererRef}
                  />
                </RendererFrame>
              </RendererContainer>
            ) : (
              // `isOpening` is always false here because `handleOpen`
              // synchronously flips `running` to true, swapping in the
              // AppRenderer before the panel could render its loading
              // state. The prop stays in `AppDetailPanel`'s API for
              // standalone use (the `Opening` story) and for Phase 3
              // wiring, where a managed-state hook can hold the panel
              // in a pending state across an awaited `tools/call`.
              <AppDetailPanel
                tool={selectedTool}
                formValues={formValues}
                isOpening={false}
                onFormChange={(values) =>
                  onUiChange({ ...ui, formValues: values })
                }
                onOpenApp={handleOpen}
              />
            )}
          </ContentStack>
        ) : (
          <EmptyState>Select an app to view details</EmptyState>
        )}
      </ContentCard>
    </ScreenLayout>
  );
}
