import React from "react";
import { Box, Text } from "ink";

export type TabType =
  | "info"
  | "auth"
  | "resources"
  | "prompts"
  | "tools"
  | "messages"
  | "requests"
  | "logging";

interface TabsProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  width: number;
  counts?: {
    info?: number;
    auth?: number;
    resources?: number;
    prompts?: number;
    tools?: number;
    messages?: number;
    requests?: number;
    logging?: number;
  };
  focused?: boolean;
  showAuth?: boolean;
  showLogging?: boolean;
  showRequests?: boolean;
}

export const tabs: { id: TabType; label: string; accelerator: string }[] = [
  { id: "info", label: "Info", accelerator: "i" },
  { id: "auth", label: "Auth", accelerator: "a" },
  { id: "resources", label: "Resources", accelerator: "r" },
  { id: "prompts", label: "Prompts", accelerator: "p" },
  { id: "tools", label: "Tools", accelerator: "t" },
  { id: "messages", label: "Messages", accelerator: "m" },
  { id: "requests", label: "HTTP Requests", accelerator: "h" },
  { id: "logging", label: "Logging", accelerator: "l" },
];

export function Tabs({
  activeTab,
  onTabChange,
  width,
  counts = {},
  focused = false,
  showAuth = true,
  showLogging = true,
  showRequests = false,
}: TabsProps) {
  let visibleTabs = tabs;
  if (!showAuth) {
    visibleTabs = visibleTabs.filter((tab) => tab.id !== "auth");
  }
  if (!showLogging) {
    visibleTabs = visibleTabs.filter((tab) => tab.id !== "logging");
  }
  if (!showRequests) {
    visibleTabs = visibleTabs.filter((tab) => tab.id !== "requests");
  }

  return (
    <Box
      width={width}
      flexShrink={0}
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderBottom={true}
      flexDirection="row"
      justifyContent="space-between"
      flexWrap="wrap"
      paddingX={1}
    >
      {visibleTabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const count = counts[tab.id];
        const countText = count !== undefined ? ` (${count})` : "";
        const firstChar = tab.label[0];
        const restOfLabel = tab.label.slice(1);

        return (
          <Box key={tab.id} flexShrink={0}>
            <Text
              bold={isActive}
              {...(isActive && focused
                ? {}
                : { color: isActive ? "cyan" : "gray" })}
              backgroundColor={isActive && focused ? "yellow" : undefined}
            >
              {isActive ? "▶ " : "  "}
              <Text underline>{firstChar}</Text>
              {restOfLabel}
              {countText}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
