import { useState, type Ref } from "react";
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
import {
  AppRenderer,
  type AppRendererHandle,
  type BridgeFactory,
} from "../../elements/AppRenderer/AppRenderer";
import { AppDetailPanel } from "../../groups/AppDetailPanel/AppDetailPanel";
import { AppControls } from "../../groups/AppControls/AppControls";
import { hasInputFields, resolveDisplayLabel } from "../../../utils/toolUtils";

export interface AppsScreenProps {
  tools: Tool[];
  listChanged: boolean;
  sandboxPath: string;
  bridgeFactory: BridgeFactory;
  rendererRef: Ref<AppRendererHandle>;
  onRefreshList: () => void;
  onSelectApp: (name: string) => void;
  onOpenApp: (name: string, args: Record<string, unknown>) => void;
  onCloseApp: () => void;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100vh - var(--app-shell-header-height, 0px))",
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

const ContentCard = Card.withProps({
  withBorder: true,
  padding: "lg",
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

const RendererFrame = Stack.withProps({
  flex: 1,
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
  onRefreshList,
  onSelectApp,
  onOpenApp,
  onCloseApp,
}: AppsScreenProps) {
  const [selectedAppName, setSelectedAppName] = useState<string | undefined>(
    undefined,
  );
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [running, setRunning] = useState(false);
  const [maximized, setMaximized] = useState(false);

  const selectedTool = selectedAppName
    ? tools.find((t) => t.name === selectedAppName)
    : undefined;
  const selectedHasFields = selectedTool ? hasInputFields(selectedTool) : false;

  function handleSelect(name: string) {
    if (name === selectedAppName) return;
    const next = tools.find((t) => t.name === name);
    if (!next) return;
    setSelectedAppName(name);
    setFormValues({});
    setMaximized(false);
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
    setRunning(true);
    onOpenApp(selectedTool.name, formValues);
  }

  function handleClose() {
    setRunning(false);
    setSelectedAppName(undefined);
    setFormValues({});
    setMaximized(false);
    onCloseApp();
  }

  function handleBackToInput() {
    setRunning(false);
    setMaximized(false);
  }

  return (
    <ScreenLayout>
      {!maximized && (
        <Sidebar>
          <SidebarCard>
            <AppControls
              tools={tools}
              selectedName={selectedAppName}
              listChanged={listChanged}
              onRefreshList={onRefreshList}
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
              <RendererFrame>
                {/* Keying by name forces the renderer to remount when the
                    selected app changes, ensuring a fresh bridge and iframe
                    rather than reusing the previous app's transport. */}
                <AppRenderer
                  key={selectedTool.name}
                  sandboxPath={sandboxPath}
                  tool={selectedTool}
                  bridgeFactory={bridgeFactory}
                  ref={rendererRef}
                />
              </RendererFrame>
            ) : (
              <AppDetailPanel
                tool={selectedTool}
                formValues={formValues}
                isOpening={false}
                onFormChange={setFormValues}
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
