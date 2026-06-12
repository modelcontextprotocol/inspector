import { useState } from "react";
import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  Group,
  Image,
  SegmentedControl,
  Select,
  Text,
  Title,
  Transition,
  useComputedColorScheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import { MdLightMode, MdDarkMode, MdLinkOff } from "react-icons/md";
import type { ConnectionStatus } from "@inspector/core/mcp/types.js";
import { ServerStatusIndicator } from "../../elements/ServerStatusIndicator/ServerStatusIndicator";
import mcpLogo from "../../../theme/assets/MCP.svg";
import mcpLogoDark from "../../../theme/assets/MCP-dark.svg";

interface ConnectedProps {
  connected: true;
  serverInfo: Implementation;
  status: ConnectionStatus;
  latencyMs?: number;
  activeTab: string;
  availableTabs: string[];
  onTabChange: (tab: string) => void;
  onDisconnect: () => void;
  onToggleTheme: () => void;
}

interface UnconnectedProps {
  connected: false;
  onToggleTheme: () => void;
}

export type ViewHeaderProps = ConnectedProps | UnconnectedProps;

// Keep-alive window for the header center crossfade (#1450): on connect/
// disconnect the title and tab bar swap with a fade + slide-down, staggered by
// half this duration. The motion itself is CSS (`.header-stack-cell`); keep the
// 300ms / 150ms-stagger there in sync with this value.
const HEADER_ANIM_MS = 300;
// Fixed Select width on narrow viewports (fits the longest tab label).
const SELECT_WIDTH = 140;

interface TabSnapshot {
  activeTab: string;
  availableTabs: string[];
}

// Value-key for a tab snapshot, so re-snapshotting compares by content (a fresh
// `availableTabs` array reference each render won't trigger an update loop).
function tabKey(activeTab: string, availableTabs: string[]): string {
  return `${activeTab} ${availableTabs.join(" ")}`;
}

// Tab names are single words, so newline is a safe join separator for the
// "tabs seen last render" key.
const TAB_SEP = "\n";

// Tab label that can pulse a red glow when it newly appears (#1450). The glow
// fires only while `data-glow="on"`; the `tabGlow` variant supplies the class
// and the keyframe/trigger live in App.css.
const TabGlowLabel = Text.withProps({ span: true, variant: "tabGlow" });

// SegmentedControl data with each label wrapped so the freshly-added tabs
// (`glowing`) pulse on mount. `value` (used for selection and by tests) stays
// the plain tab string.
function toGlowingTabData(tabs: string[], glowing: string[]) {
  return tabs.map((tab) => ({
    value: tab,
    label: (
      <TabGlowLabel data-glow={glowing.includes(tab) ? "on" : undefined}>
        {tab}
      </TabGlowLabel>
    ),
  }));
}

const HeaderBar = Group.withProps({
  h: "100%",
  px: "md",
  wrap: "nowrap",
  gap: "md",
});

const LeftSection = Group.withProps({
  gap: "md",
  wrap: "nowrap",
  flex: 1,
  miw: 0,
});

const LogoLink = Anchor.withProps({
  href: "https://modelcontextprotocol.io",
  target: "_blank",
  rel: "nofollow noopener noreferrer",
});

const LogoImage = Image.withProps({
  alt: "MCP",
  w: 28,
  h: 28,
  fit: "contain",
});

const ServerName = Text.withProps({
  fw: 600,
  size: "lg",
  truncate: "end",
  miw: 0,
  flex: 1,
});

const RightSection = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
  flex: 1,
  miw: 0,
  justify: "flex-end",
});

const DisconnectButton = Button.withProps({
  variant: "subtle",
  c: "red",
  size: "sm",
});

const DisconnectIcon = ActionIcon.withProps({
  variant: "subtle",
  c: "red",
  size: 36,
  "aria-label": "Disconnect",
});

const ThemeToggle = ActionIcon.withProps({
  variant: "subtle",
  size: 36,
  "aria-label": "Toggle color scheme",
});

export function ViewHeader(props: ViewHeaderProps) {
  const colorScheme = useComputedColorScheme();
  const ThemeIcon = colorScheme === "dark" ? MdLightMode : MdDarkMode;
  const showSegmented = useMediaQuery("(min-width: 992px)");
  const showDisconnectLabel = useMediaQuery("(min-width: 768px)");

  // Retain the latest connected tab list/selection so the bar can keep
  // rendering them while it animates out after disconnect (#1450). Uses React's
  // "adjust state during render" pattern, re-set only when the values change so
  // stable inputs don't loop. Tab callbacks aren't snapshotted — an exiting bar
  // isn't interactive.
  const [tabSnapshot, setTabSnapshot] = useState<TabSnapshot | null>(() =>
    props.connected
      ? { activeTab: props.activeTab, availableTabs: props.availableTabs }
      : null,
  );
  if (
    props.connected &&
    tabKey(props.activeTab, props.availableTabs) !==
      (tabSnapshot
        ? tabKey(tabSnapshot.activeTab, tabSnapshot.availableTabs)
        : "")
  ) {
    setTabSnapshot({
      activeTab: props.activeTab,
      availableTabs: props.availableTabs,
    });
  }
  const tabData: TabSnapshot | null = props.connected ? props : tabSnapshot;
  const handleTabChange = props.connected ? props.onTabChange : undefined;

  // Track which tabs newly appeared so their labels pulse a red glow (#1450).
  // Compared against the previous shown set via adjust-state-during-render, so
  // only tabs added mid-session glow — not the initial set on connect (previous
  // set empty) nor anything on disconnect. `glowing` persists in committed state
  // (it isn't cleared in the same render) so the class survives to the DOM.
  const liveTabs = props.connected ? props.availableTabs : [];
  const liveTabsKey = liveTabs.join(TAB_SEP);
  const [seenTabsKey, setSeenTabsKey] = useState(liveTabsKey);
  const [glowing, setGlowing] = useState<string[]>([]);
  if (liveTabsKey !== seenTabsKey) {
    const prev = seenTabsKey ? seenTabsKey.split(TAB_SEP) : [];
    setSeenTabsKey(liveTabsKey);
    setGlowing(prev.length ? liveTabs.filter((t) => !prev.includes(t)) : []);
  }

  const logoSrc = colorScheme === "dark" ? mcpLogoDark : mcpLogo;

  return (
    <HeaderBar>
      <LeftSection>
        <LogoLink>
          <LogoImage src={logoSrc} />
        </LogoLink>
        {props.connected ? (
          <ServerName>{props.serverInfo.name}</ServerName>
        ) : null}
      </LeftSection>

      {/* CSS grid stack: the title and tab bar cells share one cell (grid-area
          1/1 via `.header-stack-cell`), so on connect/disconnect one
          fades+slides out as the other fades+slides in, in the same place.
          `flex: 0 0 auto` keeps it from stretching within the header. */}
      <Box display="grid" flex="0 0 auto">
        {/* The Transitions are keep-alive only: when `mounted` flips false the
            cell stays in the DOM for `exitDuration` while its CSS exit animation
            (`data-anim="out"`) plays, then unmounts. `data-anim` selects the
            slide-down direction (in = descend from above, out = descend below);
            the incoming cell's CSS delay staggers it behind the outgoing one. */}
        <Transition
          mounted={props.connected}
          transition="fade"
          duration={HEADER_ANIM_MS}
          exitDuration={HEADER_ANIM_MS}
        >
          {() =>
            tabData ? (
              <Box
                className="header-stack-cell"
                data-anim={props.connected ? "in" : "out"}
              >
                {showSegmented ? (
                  <SegmentedControl
                    value={tabData.activeTab}
                    onChange={handleTabChange}
                    data={toGlowingTabData(tabData.availableTabs, glowing)}
                    size="sm"
                  />
                ) : (
                  <Select
                    value={tabData.activeTab}
                    onChange={(value) => value && handleTabChange?.(value)}
                    data={tabData.availableTabs}
                    size="sm"
                    allowDeselect={false}
                    w={SELECT_WIDTH}
                  />
                )}
              </Box>
            ) : (
              // Unreachable in practice — the Transition only mounts while
              // connected, by which point the snapshot is set — but the render
              // prop must return an element, never null.
              <></>
            )
          }
        </Transition>
        <Transition
          mounted={!props.connected}
          transition="fade"
          duration={HEADER_ANIM_MS}
          exitDuration={HEADER_ANIM_MS}
        >
          {() => (
            <Box
              className="header-stack-cell"
              data-anim={props.connected ? "out" : "in"}
            >
              <Title order={2}>MCP Inspector</Title>
            </Box>
          )}
        </Transition>
      </Box>

      <RightSection>
        {props.connected ? (
          <>
            <ServerStatusIndicator
              status={props.status}
              latencyMs={props.latencyMs}
            />
            {showDisconnectLabel ? (
              <DisconnectButton onClick={props.onDisconnect}>
                Disconnect
              </DisconnectButton>
            ) : (
              <DisconnectIcon onClick={props.onDisconnect} title="Disconnect">
                <MdLinkOff size={20} />
              </DisconnectIcon>
            )}
          </>
        ) : null}
        <ThemeToggle onClick={props.onToggleTheme}>
          <ThemeIcon size={20} />
        </ThemeToggle>
      </RightSection>
    </HeaderBar>
  );
}
