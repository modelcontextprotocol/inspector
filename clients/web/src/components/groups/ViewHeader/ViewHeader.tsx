import {
  ActionIcon,
  Anchor,
  Button,
  Group,
  Image,
  SegmentedControl,
  Text,
  Title,
} from "@mantine/core";
import { useComputedColorScheme } from "@mantine/core";
import { MdLightMode, MdDarkMode } from "react-icons/md";
import { ServerStatusIndicator } from "../../elements/ServerStatusIndicator/ServerStatusIndicator";
import mcpLogo from "../../../theme/assets/MCP.svg";
import mcpLogoDark from "../../../theme/assets/MCP-dark.svg";

interface ConnectedProps {
  connected: true;
  serverName: string;
  status: "connected" | "connecting" | "error";
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
  gap: 0,
});

const LeftSection = Group.withProps({
  gap: "md",
  wrap: "nowrap",
  w: "33.33%",
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
  maw: "calc(100% - 40px)",
});

const CenterSection = Group.withProps({
  w: "33.33%",
  justify: "center",
});

const RightSection = Group.withProps({
  gap: "sm",
  w: "33.33%",
  justify: "flex-end",
});

const DisconnectButton = Button.withProps({
  variant: "subtle",
  c: "red",
  size: "sm",
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

export function ViewHeader(props: ViewHeaderProps) {
  const colorScheme = useComputedColorScheme();
  const ThemeIcon = colorScheme === "dark" ? MdLightMode : MdDarkMode;

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
        <ServerName>{props.serverName}</ServerName>
      </LeftSection>

      <CenterSection>
        <SegmentedControl
          value={props.activeTab}
          onChange={props.onTabChange}
          data={props.availableTabs}
          size="sm"
        />
      </CenterSection>

      <RightSection>
        <ServerStatusIndicator
          status={props.status}
          latencyMs={props.latencyMs}
        />
        <DisconnectButton onClick={props.onDisconnect}>
          Disconnect
        </DisconnectButton>
        <ThemeToggle onClick={props.onToggleTheme}>
          <ThemeIcon size={20} />
        </ThemeToggle>
      </RightSection>
    </HeaderBar>
  );
}
