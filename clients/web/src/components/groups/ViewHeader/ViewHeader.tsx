import {
  ActionIcon,
  Anchor,
  Button,
  Group,
  Image,
  SegmentedControl,
  Select,
  Text,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import { useElementSize, useMediaQuery } from "@mantine/hooks";
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

const CenterSection = Group.withProps({
  wrap: "nowrap",
  flex: "0 0 auto",
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

const UnconnectedBar = Group.withProps({
  h: "100%",
  px: "md",
  justify: "space-between",
});

// Clips the SegmentedControl to an animated width (theme `tabBar` variant,
// #1450). The runtime `width` is supplied per-render from the measured
// control size; the static `display`/`overflow`/`transition` live in the
// variant.
const TabBarClip = Group.withProps({ variant: "tabBar" });

export function ViewHeader(props: ViewHeaderProps) {
  const colorScheme = useComputedColorScheme();
  const ThemeIcon = colorScheme === "dark" ? MdLightMode : MdDarkMode;
  const showSegmented = useMediaQuery("(min-width: 992px)");
  const showDisconnectLabel = useMediaQuery("(min-width: 768px)");
  // Measures the SegmentedControl's border-box width so the clip wrapper can
  // animate between sizes when a tab is added or removed (#1450). Falls back
  // to auto width until the observer first reports (e.g. environments without
  // ResizeObserver), so the bar still renders at its natural size.
  const { ref: tabBarRef, width: tabBarWidth } = useElementSize();

  if (!props.connected) {
    return (
      <UnconnectedBar>
        <LogoLink>
          <LogoImage src={colorScheme === "dark" ? mcpLogoDark : mcpLogo} />
        </LogoLink>
        <Title order={2}>MCP Inspector</Title>
        <ThemeToggle onClick={props.onToggleTheme}>
          <ThemeIcon size={20} />
        </ThemeToggle>
      </UnconnectedBar>
    );
  }

  return (
    <HeaderBar>
      <LeftSection>
        <LogoLink>
          <LogoImage src={colorScheme === "dark" ? mcpLogoDark : mcpLogo} />
        </LogoLink>
        <ServerName>{props.serverInfo.name}</ServerName>
      </LeftSection>

      <CenterSection>
        {showSegmented ? (
          // `style={{ width }}` is the runtime measured size driving the
          // width transition — the static clip styles live in the `tabBar`
          // variant. `w="max-content"` keeps the control at its natural width
          // so the measurement (and clip) reflect the true content size.
          <TabBarClip style={{ width: tabBarWidth || undefined }}>
            <SegmentedControl
              ref={tabBarRef}
              w="max-content"
              value={props.activeTab}
              onChange={props.onTabChange}
              data={props.availableTabs}
              size="sm"
            />
          </TabBarClip>
        ) : (
          <Select
            value={props.activeTab}
            onChange={(value) => value && props.onTabChange(value)}
            data={props.availableTabs}
            size="sm"
            allowDeselect={false}
            // Sized to comfortably fit the longest current tab label
            // ("Resources"). Revisit if longer tabs are added.
            w={140}
          />
        )}
      </CenterSection>

      <RightSection>
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
        <ThemeToggle onClick={props.onToggleTheme}>
          <ThemeIcon size={20} />
        </ThemeToggle>
      </RightSection>
    </HeaderBar>
  );
}
