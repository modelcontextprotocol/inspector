import { useEffect, useState } from "react";
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
  Tooltip,
  Transition,
  useComputedColorScheme,
  type MantineTransition,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import { MdLightMode, MdDarkMode, MdSettings } from "react-icons/md";
import { VscDebugDisconnect } from "react-icons/vsc";
import type { ConnectionStatus } from "@inspector/core/mcp/types.js";
import { ServerStatusIndicator } from "../../elements/ServerStatusIndicator/ServerStatusIndicator";
import {
  MonitoringToggle,
  type MonitoringToggleProps,
} from "../../elements/MonitoringToggle/MonitoringToggle";
import mcpLogo from "../../../theme/assets/MCP.svg";
import mcpLogoDark from "../../../theme/assets/MCP-dark.svg";

// The single monitoring-sidebar affordance (#1661): its open state + toggle
// callback (`MonitoringToggleProps`, reused as the one source of truth). Present
// only when the sidebar is available (connected, or a failed connect attempt,
// on a wide viewport); undefined otherwise so no toggle shows.
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
  onOpenClientSettings: () => void;
  /** Monitoring-sidebar toggle, shown to the right of the theme icon. */
  monitorToggle?: MonitoringToggleProps;
}

interface UnconnectedProps {
  connected: false;
  onToggleTheme: () => void;
  onOpenClientSettings: () => void;
  /** Monitoring-sidebar toggle, shown to the right of the theme icon. */
  monitorToggle?: MonitoringToggleProps;
}

export type ViewHeaderProps = ConnectedProps | UnconnectedProps;

// Keep-alive window for the header connect/disconnect animations (#1450): the
// center title↔tab-bar crossfade plus the server name (left) and status +
// Disconnect controls (right) all fade + slide-down, staggered by half this
// duration. The motion itself is CSS (`.header-anim`); keep the 300ms /
// 150ms-stagger there in sync with this value.
const HEADER_ANIM_MS = 300;
// Fixed Select width on narrow viewports (fits the longest tab label).
const SELECT_WIDTH = 140;
// Grace window after a connection is established before the new-tab glow arms
// (#1450). Primitive lists (prompts/resources/tasks) are fetched asynchronously
// just after the handshake, so their tabs appear a few renders into the
// connection; without this window they'd be mistaken for mid-session additions
// and glow on initial load. Tabs that resolve within this window are treated as
// part of the initial set and don't glow.
//
// This keys on time-since-connect, not on lists having settled, so it's a
// heuristic: a server whose lists resolve slower than this still glows on its
// slow tail, and a fast server pays a small arming delay. 1s is a reasonable
// middle ground; if the InspectorClient ever exposes an "initial fetches done"
// signal, gating on that would be more robust than a fixed timer.
const GLOW_GRACE_MS = 1000;

// Tab names are single words, so newline is a safe join separator for the
// "tabs seen / shown" keys.
const TAB_SEP = "\n";

function tabsKey(tabs: string[]): string {
  return tabs.join(TAB_SEP);
}

// Connected-header display data retained so each region can keep rendering while
// it animates out after disconnect (the live props are gone by then).
interface HeaderSnapshot {
  serverName: string;
  status: ConnectionStatus;
  latencyMs?: number;
  activeTab: string;
  availableTabs: string[];
}

// Value-key for a snapshot, so re-snapshotting compares by content (fresh array
// references each render won't trigger an update loop).
function snapshotKey(s: HeaderSnapshot): string {
  return [
    s.serverName,
    s.status,
    s.latencyMs ?? "",
    s.activeTab,
    tabsKey(s.availableTabs),
  ].join(TAB_SEP);
}

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

// Server name carries the `header-anim` class so it fades + slides on
// connect/disconnect (the `data-anim` direction is set per render).
const ServerName = Text.withProps({
  className: "header-anim",
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

// The status indicator + Disconnect control animate as one unit on
// connect/disconnect (the theme toggle stays put outside it).
const RightConnectedGroup = Group.withProps({
  className: "header-anim",
  gap: "sm",
  wrap: "nowrap",
});

const DisconnectButton = Button.withProps({
  variant: "subtle",
  // `color` drives the subtle hover/active tint; `c` overrides just the label
  // to the AA-compliant danger red (red.6 text alone fell under contrast).
  color: "red.6",
  size: "sm",
  c: "var(--inspector-danger-text)",
});

const DisconnectIcon = ActionIcon.withProps({
  variant: "subtle",
  size: 36,
  "aria-label": "Disconnect from server",
});

const ClientSettingsToggle = ActionIcon.withProps({
  variant: "subtle",
  size: 36,
  "aria-label": "Client settings",
});

const ThemeToggle = ActionIcon.withProps({
  variant: "subtle",
  size: 36,
  "aria-label": "Toggle color scheme",
});

// Enter/exit animation for the monitoring-sidebar toggle (#1661). It occupies a
// slot to the right of the theme icon; when it appears it slides in and grows
// its width from 0 → the 36px icon, which — because RightSection is a flex-end
// row — pushes the theme + client-settings buttons one slot to the left. On exit
// it reverses and those buttons slide back over. The negative `marginLeft` in
// `out` cancels RightSection's `sm` gap while collapsed so the theme icon stays
// flush to the right edge (no dead gap). `overflow: hidden` clips the icon as
// the slot narrows so it reads as a slide-in reveal. The 36 matches the icon.
const TOGGLE_ANIM_MS = 200;
const toggleSlide: MantineTransition = {
  in: { opacity: 1, width: 36, marginLeft: 0, transform: "translateX(0)" },
  out: {
    opacity: 0,
    width: 0,
    marginLeft: "calc(var(--mantine-spacing-sm) * -1)",
    transform: "translateX(-8px)",
  },
  common: { overflow: "hidden", flexShrink: 0 },
  transitionProperty: "opacity, width, margin-left, transform",
};

export function ViewHeader(props: ViewHeaderProps) {
  const colorScheme = useComputedColorScheme();
  // Retain the latest toggle props so the control keeps rendering its final
  // state while it slides out after `monitorToggle` clears (the Transition below
  // keeps it mounted for the exit). Adjust-state-during-render, gated on the
  // `open` primitive — the parent hands us a fresh object/callback each render,
  // so comparing by identity would loop; `open` is the only bit that changes the
  // rendered control, and the exiting toggle isn't interactive anyway.
  const [lastMonitorToggle, setLastMonitorToggle] = useState(
    props.monitorToggle,
  );
  if (
    props.monitorToggle &&
    props.monitorToggle.open !== lastMonitorToggle?.open
  ) {
    setLastMonitorToggle(props.monitorToggle);
  }
  const monitorToggleForRender = props.monitorToggle ?? lastMonitorToggle;
  const ThemeIcon = colorScheme === "dark" ? MdLightMode : MdDarkMode;
  const showSegmented = useMediaQuery("(min-width: 992px)");
  // Below the 1280px app min-width the header runs out of room (with every tab
  // shown, the Disconnect label clips), so collapse the Disconnect control to its
  // icon at that floor. The connection status text drops earlier, at 1500px —
  // it's the wider element — so the two shed independently (see
  // ServerStatusIndicator).
  const showDisconnectLabel = useMediaQuery("(min-width: 1281px)");

  // Retain the latest connected display data so each region can keep rendering
  // it while animating out after disconnect (#1450). Uses React's "adjust state
  // during render" pattern, re-set only when the values change (compared by key)
  // so stable inputs don't loop. Callbacks aren't snapshotted — an exiting
  // header isn't interactive.
  const liveSnapshot: HeaderSnapshot | null = props.connected
    ? {
        serverName: props.serverInfo.name,
        status: props.status,
        latencyMs: props.latencyMs,
        activeTab: props.activeTab,
        availableTabs: props.availableTabs,
      }
    : null;
  const [snapshot, setSnapshot] = useState<HeaderSnapshot | null>(liveSnapshot);
  if (
    liveSnapshot &&
    snapshotKey(liveSnapshot) !== (snapshot ? snapshotKey(snapshot) : "")
  ) {
    setSnapshot(liveSnapshot);
  }
  const headerData = props.connected ? liveSnapshot : snapshot;
  const handleTabChange = props.connected ? props.onTabChange : undefined;
  const handleDisconnect = props.connected ? props.onDisconnect : undefined;

  // The glow only arms once the connection has settled (GLOW_GRACE_MS after
  // connect), so tabs whose lists resolve asynchronously just after the
  // handshake count as the initial set and don't glow. Reset on disconnect via
  // adjust-state-during-render; armed by the timer effect below.
  const [glowArmed, setGlowArmed] = useState(false);
  if (!props.connected && glowArmed) {
    setGlowArmed(false);
  }
  useEffect(() => {
    if (!props.connected) return;
    const id = setTimeout(() => setGlowArmed(true), GLOW_GRACE_MS);
    return () => clearTimeout(id);
  }, [props.connected]);

  // Track which tabs newly appeared so their labels pulse a red glow (#1450).
  // Compared against the previous shown set via adjust-state-during-render, so
  // only tabs added mid-session glow — not the initial set on connect, the
  // async-resolved lists during the grace window, nor anything on disconnect.
  // `glowing` persists in committed state (it isn't cleared in the same render)
  // so the class survives to the DOM.
  const liveTabs = props.connected ? props.availableTabs : [];
  const liveTabsKey = tabsKey(liveTabs);
  const [seenTabsKey, setSeenTabsKey] = useState(liveTabsKey);
  const [glowing, setGlowing] = useState<string[]>([]);
  if (liveTabsKey !== seenTabsKey) {
    const prev = seenTabsKey ? seenTabsKey.split(TAB_SEP) : [];
    setSeenTabsKey(liveTabsKey);
    setGlowing(
      glowArmed && prev.length ? liveTabs.filter((t) => !prev.includes(t)) : [],
    );
  }

  // `in` while present/entering, `out` while exiting — drives the slide-down
  // direction for every connect/disconnect-animated region.
  const connectedAnim = props.connected ? "in" : "out";

  const logoSrc = colorScheme === "dark" ? mcpLogoDark : mcpLogo;

  return (
    <HeaderBar>
      <LeftSection>
        <Tooltip label="MCP Documentation">
          <LogoLink>
            <LogoImage src={logoSrc} />
          </LogoLink>
        </Tooltip>
        <Transition
          mounted={props.connected}
          transition="fade"
          duration={HEADER_ANIM_MS}
          exitDuration={HEADER_ANIM_MS}
        >
          {() =>
            headerData ? (
              <ServerName data-anim={connectedAnim}>
                {headerData.serverName}
              </ServerName>
            ) : (
              /* v8 ignore next -- unreachable: this Transition only mounts
                 while connected, by which point headerData is set; the render
                 prop must still return an element, never null. */
              <></>
            )
          }
        </Transition>
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
            headerData ? (
              <Box
                className="header-anim header-stack-cell"
                data-anim={connectedAnim}
              >
                {showSegmented ? (
                  <SegmentedControl
                    value={headerData.activeTab}
                    onChange={handleTabChange}
                    data={toGlowingTabData(headerData.availableTabs, glowing)}
                    size="sm"
                  />
                ) : (
                  // Narrow viewport: the new-tab glow doesn't apply to the
                  // dropdown (a collapsed Select can't pulse a single option),
                  // so the labels stay plain strings here.
                  <Select
                    value={headerData.activeTab}
                    onChange={(value) => value && handleTabChange?.(value)}
                    data={headerData.availableTabs}
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
              /* v8 ignore next */
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
              className="header-anim header-stack-cell"
              data-anim={props.connected ? "out" : "in"}
            >
              <Title order={2}>MCP Inspector</Title>
            </Box>
          )}
        </Transition>
      </Box>

      <RightSection>
        <Transition
          mounted={props.connected}
          transition="fade"
          duration={HEADER_ANIM_MS}
          exitDuration={HEADER_ANIM_MS}
        >
          {() =>
            headerData ? (
              <RightConnectedGroup data-anim={connectedAnim}>
                <ServerStatusIndicator
                  status={headerData.status}
                  latencyMs={headerData.latencyMs}
                />
                {showDisconnectLabel ? (
                  <DisconnectButton onClick={handleDisconnect}>
                    Disconnect
                  </DisconnectButton>
                ) : (
                  <Tooltip label="Disconnect from server">
                    <DisconnectIcon onClick={handleDisconnect}>
                      <VscDebugDisconnect size={20} />
                    </DisconnectIcon>
                  </Tooltip>
                )}
              </RightConnectedGroup>
            ) : (
              /* v8 ignore next -- unreachable: this Transition only mounts
                 while connected, by which point headerData is set; the render
                 prop must still return an element, never null. */
              <></>
            )
          }
        </Transition>
        <Tooltip label="Client settings">
          <ClientSettingsToggle onClick={props.onOpenClientSettings}>
            <MdSettings size={20} />
          </ClientSettingsToggle>
        </Tooltip>
        <Tooltip
          label={
            colorScheme === "dark"
              ? "Switch to light theme"
              : "Switch to dark theme"
          }
        >
          <ThemeToggle onClick={props.onToggleTheme}>
            <ThemeIcon size={20} />
          </ThemeToggle>
        </Tooltip>
        <Transition
          mounted={!!props.monitorToggle}
          transition={toggleSlide}
          duration={TOGGLE_ANIM_MS}
          exitDuration={TOGGLE_ANIM_MS}
          timingFunction="ease"
        >
          {(styles) =>
            monitorToggleForRender ? (
              // `style={styles}` is Mantine's runtime Transition interpolation
              // (width/margin/opacity/transform), not static styling — same
              // pattern as the column slide in InspectorView.
              <Box style={styles}>
                <MonitoringToggle
                  open={monitorToggleForRender.open}
                  onToggle={monitorToggleForRender.onToggle}
                />
              </Box>
            ) : (
              /* v8 ignore next -- unreachable: the Transition only mounts once a
                 toggle has existed, so the snapshot is always set when rendered */
              <></>
            )
          }
        </Transition>
      </RightSection>
    </HeaderBar>
  );
}
