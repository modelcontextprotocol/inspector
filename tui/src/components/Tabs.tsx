import React from "react";
import { Box, Text } from "ink";

export type TabType =
  | "info"
  | "resources"
  | "prompts"
  | "tools"
  | "messages"
  | "logging";

interface TabsProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  width: number;
  counts?: {
    info?: number;
    resources?: number;
    prompts?: number;
    tools?: number;
    messages?: number;
    logging?: number;
  };
  focused?: boolean;
  showLogging?: boolean;
}

export const tabs: { id: TabType; label: string; accelerator: string }[] = [
  { id: "info", label: "Info", accelerator: "i" },
  { id: "resources", label: "Resources", accelerator: "r" },
  { id: "prompts", label: "Prompts", accelerator: "p" },
  { id: "tools", label: "Tools", accelerator: "t" },
  { id: "messages", label: "Messages", accelerator: "m" },
  { id: "logging", label: "Logging", accelerator: "l" },
];

export function Tabs({
  activeTab,
  onTabChange,
  width,
  counts = {},
  focused = false,
  showLogging = true,
}: TabsProps) {
  const visibleTabs = showLogging
    ? tabs
    : tabs.filter((tab) => tab.id !== "logging");

  return (
    <Box
      width={width}
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
