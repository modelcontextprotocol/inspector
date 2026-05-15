import { Button, Group, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { MdAdd, MdClose, MdCenterFocusStrong } from "react-icons/md";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";

export interface ProtocolPaletteSidebarProps {
  tools: Tool[];
  recVars: string[];
  listChanged: boolean;
  targetTerminated: boolean;
  targetLabel: string | null;
  onRefreshTools: () => void;
  onClearTarget: () => void;
  onAddTool: (tool: Tool) => void;
  onAddPair: () => void;
  onAddInternalChoice: () => void;
  onAddExternalChoice: () => void;
  onAddRecursion: () => void;
  onAddRecRef: (varName: string) => void;
}

const HeaderRow = Group.withProps({
  justify: "space-between",
  align: "center",
});

const SectionLabel = Text.withProps({
  size: "xs",
  fw: 600,
  tt: "uppercase",
  c: "dimmed",
});

const TargetBanner = Paper.withProps({
  p: "xs",
  withBorder: true,
  bg: "var(--inspector-protocol-target-bg)",
  bd: "1px solid var(--inspector-protocol-target-border)",
});

const ToolButton = Button.withProps({
  variant: "default",
  size: "sm",
  fullWidth: true,
  justify: "flex-start",
});

const ConstructButton = Button.withProps({
  variant: "default",
  size: "sm",
  fullWidth: true,
  justify: "flex-start",
});

const SendGlyph = Text.withProps({
  span: true,
  ff: "monospace",
  c: "var(--inspector-protocol-send-text)",
  fw: 700,
});

const ReceiveGlyph = Text.withProps({
  span: true,
  ff: "monospace",
  c: "var(--inspector-protocol-receive-text)",
  fw: 700,
});

const RecursionGlyph = Text.withProps({
  span: true,
  ff: "monospace",
  c: "var(--inspector-protocol-recursion-text)",
  fw: 700,
});

const PALETTE_MAX_HEIGHT =
  "calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2)";

export function ProtocolPaletteSidebar({
  tools,
  recVars,
  listChanged,
  targetTerminated,
  targetLabel,
  onRefreshTools,
  onClearTarget,
  onAddTool,
  onAddPair,
  onAddInternalChoice,
  onAddExternalChoice,
  onAddRecursion,
  onAddRecRef,
}: ProtocolPaletteSidebarProps) {
  return (
    <ScrollArea.Autosize mah={PALETTE_MAX_HEIGHT}>
      <Stack gap="md">
        <HeaderRow>
          <Text fw={600} size="sm">
            MCP Tools
          </Text>
          <ListChangedIndicator
            visible={listChanged}
            onRefresh={onRefreshTools}
          />
        </HeaderRow>

        {targetLabel ? (
          <TargetBanner>
            <Group gap="xs" wrap="nowrap">
              <MdCenterFocusStrong
                size={14}
                color="var(--inspector-protocol-receive-text)"
              />
              <Text size="xs" flex={1}>
                Adding to: <strong>{targetLabel}</strong>
              </Text>
              <Button
                variant="subtle"
                size="compact-xs"
                onClick={onClearTarget}
                aria-label="Clear insert target"
              >
                <MdClose size={12} />
              </Button>
            </Group>
          </TargetBanner>
        ) : null}

        {tools.length === 0 ? (
          <Stack gap="xs" align="center" py="md">
            <Text size="sm" c="dimmed">
              No tools discovered yet
            </Text>
            <Button variant="default" size="xs" onClick={onRefreshTools}>
              List Tools
            </Button>
          </Stack>
        ) : (
          <Stack gap="xs">
            <SectionLabel>Available Tools ({tools.length})</SectionLabel>
            {tools.map((tool) => (
              <ToolButton
                key={tool.name}
                disabled={targetTerminated}
                onClick={() => onAddTool(tool)}
                rightSection={<MdAdd size={12} />}
              >
                <Text ff="monospace" size="xs" fw={500} truncate>
                  {tool.name}
                </Text>
              </ToolButton>
            ))}
          </Stack>
        )}

        <Stack gap="xs">
          <SectionLabel>Protocol Constructs</SectionLabel>
          <ConstructButton
            disabled={targetTerminated}
            onClick={onAddPair}
            leftSection={
              <Text span ff="monospace" size="xs">
                <SendGlyph>!</SendGlyph>
                <ReceiveGlyph>?</ReceiveGlyph>
              </Text>
            }
          >
            Send / Receive Pair
          </ConstructButton>
          <ConstructButton
            disabled={targetTerminated}
            onClick={onAddInternalChoice}
            leftSection={<SendGlyph>!{"{}"}</SendGlyph>}
          >
            Internal Choice
          </ConstructButton>
          <ConstructButton
            disabled={targetTerminated}
            onClick={onAddExternalChoice}
            leftSection={<ReceiveGlyph>?{"{}"}</ReceiveGlyph>}
          >
            External Choice
          </ConstructButton>
          <ConstructButton
            disabled={targetTerminated}
            onClick={onAddRecursion}
            leftSection={<RecursionGlyph>rec</RecursionGlyph>}
          >
            Recursion
          </ConstructButton>
          {recVars.map((v) => (
            <Button
              key={v}
              variant="subtle"
              size="xs"
              fullWidth
              justify="flex-start"
              disabled={targetTerminated}
              onClick={() => onAddRecRef(v)}
              leftSection={<RecursionGlyph>↻</RecursionGlyph>}
            >
              Loop back to {v}
            </Button>
          ))}
        </Stack>
      </Stack>
    </ScrollArea.Autosize>
  );
}
