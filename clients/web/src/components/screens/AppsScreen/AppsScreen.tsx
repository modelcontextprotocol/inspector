import { useRef, useState, type Ref } from "react";
import {
  ActionIcon,
  Button,
  Card,
  Code,
  Collapse,
  Flex,
  Group,
  Image,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  MdArrowBack,
  MdClose,
  MdFullscreen,
  MdFullscreenExit,
} from "react-icons/md";
import type {
  ContentBlock,
  LoggingMessageNotification,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpUiDisplayMode } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  AppRenderer,
  type AppRendererHandle,
  type BridgeFactory,
} from "../../elements/AppRenderer/AppRenderer";
import { HOST_AVAILABLE_DISPLAY_MODES } from "../../elements/AppRenderer/createAppBridgeFactory";
import { AppDetailPanel } from "../../groups/AppDetailPanel/AppDetailPanel";
import { AppControls } from "../../groups/AppControls/AppControls";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { LogLevelBadge } from "../../elements/LogLevelBadge/LogLevelBadge";
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
// view's reported content height — that drives the inner box — so the
// renderer's containerDimensions observer can measure this element without
// coupling host→view container size to view→host size-changed.
const RendererContainer = Stack.withProps({
  flex: 1,
  miw: 0,
  mih: 0,
  gap: 0,
});

const ContentStack = Stack.withProps({
  gap: "md",
  h: "100%",
});

// Pinned panel below the running app (used by both the message log and the
// app-log panel). `0 0 auto` keeps it at its content height (capped by the
// inner scroll's `mah`) so it never squeezes out the iframe above it.
const PinnedPanel = Stack.withProps({
  gap: "xs",
  flex: "0 0 auto",
  mih: 0,
});

const LogScroll = ScrollArea.withProps({
  mah: 200,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const MessageLogStack = Stack.withProps({
  gap: "sm",
});

const MessageItem = Paper.withProps({
  p: "md",
  radius: "md",
  withBorder: true,
});

const MessageItemStack = Stack.withProps({
  gap: "xs",
});

const MonoCaption = Text.withProps({
  size: "xs",
  c: "dimmed",
  ff: "monospace",
});

const AppLogList = Stack.withProps({
  gap: "xs",
});

const AppLogRow = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
  align: "flex-start",
});

const AppLogData = Code.withProps({
  block: true,
  fz: "xs",
});

const CompactSubtleButton = Button.withProps({
  variant: "subtle",
  size: "compact-xs",
});

const PanelHeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
  gap: "sm",
});

/** Render a log payload as a string for display. */
function formatLogData(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    /* v8 ignore next -- JSON.stringify only throws on a BigInt or a circular
       structure; a log payload delivered over postMessage is already
       structured-clone-safe, so this fallback is unreachable in practice. */
    return String(data);
  }
}

// A user-role message submitted by the running view through ui/message. The
// inspector has no conversation to append to, so it just records the content
// blocks for display. Shape matches McpUiMessageRequest["params"].
interface AppMessage {
  role: "user";
  content: ContentBlock[];
}

/**
 * One MCP `notifications/message` log entry from the running app, with the
 * payload stringified once at capture time so the render path can use it
 * directly. `id` is a stable React key.
 */
interface AppLogEntry {
  id: number;
  level: LoggingMessageNotification["params"]["level"];
  logger?: string;
  text: string;
}

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
  const nextLogIdRef = useRef(0);
  // Height (px) the running view last reported via ui/notifications/size-changed.
  // Undefined until the view reports (or after it's torn down), in which case
  // the iframe fills the available card space as before. Local to the screen
  // like `running`/`maximized`: it's tied to the live iframe, not persisted.
  const [appHeight, setAppHeight] = useState<number | undefined>(undefined);
  // Messages the running view has pushed via ui/message. The inspector has no
  // chat loop, so they're collected here and shown in a log below the app
  // rather than continuing a conversation. Local to the screen like `running`:
  // tied to the live bridge, cleared when the open ends or the app changes.
  const [messages, setMessages] = useState<AppMessage[]>([]);
  // Standard MCP log notifications (notifications/message) the running app
  // emits. The host advertises the `logging` capability; without surfacing
  // these here they'd be silently dropped by the bridge. Same lifecycle as
  // `messages`: tied to the live bridge, cleared on open/close/switch.
  const [appLogs, setAppLogs] = useState<AppLogEntry[]>([]);
  // Expanded by default so a widget developer sees the entries without an extra
  // click. The user can still collapse it for the rest of the run.
  const [appLogsExpanded, setAppLogsExpanded] = useState(true);

  const selectedTool = selectedAppName
    ? tools.find((t) => t.name === selectedAppName)
    : undefined;
  const selectedHasFields = selectedTool ? hasInputFields(selectedTool) : false;

  // The running view reports its rendered content height via
  // ui/notifications/size-changed; honor it so the iframe is neither clipped
  // nor surrounded by dead space. Width is left at the host-controlled
  // container width. The value is clamped to the available space by the
  // renderer frame's `mah` below, and ignored while maximized (the app fills
  // the screen instead).
  function handleSizeChange(size: { width?: number; height?: number }) {
    if (size.height != null) setAppHeight(size.height);
  }

  function handleMessage(params: AppMessage) {
    setMessages((prev) => [...prev, params]);
  }

  function handleLog(params: LoggingMessageNotification["params"]) {
    setAppLogs((prev) => [
      ...prev,
      {
        id: nextLogIdRef.current++,
        level: params.level,
        logger: params.logger,
        text: formatLogData(params.data),
      },
    ]);
  }

  // Clear the message + log panels (and the reported height). Called when a run
  // ends or the selected app changes so a new run starts clean.
  function resetAppChannels() {
    setAppHeight(undefined);
    setMessages([]);
    setAppLogs([]);
    setAppLogsExpanded(true);
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
    resetAppChannels();
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
    resetAppChannels();
    setRunning(true);
    onOpenApp(selectedTool.name, formValues);
  }

  function handleClose() {
    setRunning(false);
    onUiChange({ ...ui, selectedAppName: undefined, formValues: {} });
    setMaximized(false);
    resetAppChannels();
    onCloseApp();
  }

  function handleBackToInput() {
    setRunning(false);
    setMaximized(false);
    resetAppChannels();
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
              // changes with host layout); the inner Stack is sized by the
              // view's reported content height, capped at the container.
              <RendererContainer ref={rendererContainerRef}>
                <RendererContainer
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
                    onMessage={handleMessage}
                    onLog={handleLog}
                    containerRef={rendererContainerRef}
                    ref={rendererRef}
                  />
                </RendererContainer>
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
            {running && messages.length > 0 && (
              <PinnedPanel data-testid="apps-messages">
                <Title order={5}>Messages from app ({messages.length})</Title>
                <LogScroll>
                  <MessageLogStack>
                    {messages.map((message, index) => (
                      <MessageItem key={index}>
                        <MessageItemStack>
                          <MonoCaption>
                            [{index}] role: {message.role}
                          </MonoCaption>
                          {message.content.map((block, blockIndex) => (
                            <ContentViewer
                              key={blockIndex}
                              block={block}
                              copyable
                            />
                          ))}
                        </MessageItemStack>
                      </MessageItem>
                    ))}
                  </MessageLogStack>
                </LogScroll>
              </PinnedPanel>
            )}
            {running && appLogs.length > 0 && (
              <PinnedPanel data-testid="apps-logs">
                <PanelHeaderRow>
                  <CompactSubtleButton
                    onClick={() => setAppLogsExpanded((e) => !e)}
                    aria-expanded={appLogsExpanded}
                  >
                    App logs ({appLogs.length})
                  </CompactSubtleButton>
                  <CompactSubtleButton onClick={() => setAppLogs([])}>
                    Clear
                  </CompactSubtleButton>
                </PanelHeaderRow>
                <Collapse in={appLogsExpanded}>
                  <LogScroll>
                    <AppLogList>
                      {appLogs.map((entry) => (
                        <AppLogRow key={entry.id}>
                          <LogLevelBadge level={entry.level} />
                          {entry.logger && (
                            <MonoCaption>{entry.logger}</MonoCaption>
                          )}
                          <AppLogData>{entry.text}</AppLogData>
                        </AppLogRow>
                      ))}
                    </AppLogList>
                  </LogScroll>
                </Collapse>
              </PinnedPanel>
            )}
          </ContentStack>
        ) : (
          <EmptyState>Select an app to view details</EmptyState>
        )}
      </ContentCard>
    </ScreenLayout>
  );
}
