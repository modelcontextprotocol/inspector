import React from "react";
import { Box, Text } from "ink";
import { type TabType, tabs } from "./tabsConfig.js";

/**
 * Split a tab label so the accelerator letter can be underlined wherever it
 * appears (not only the first character — e.g. Pro**m**pts, C**o**nsole).
 */
export function splitLabelAtAccelerator(
  label: string,
  accelerator: string,
): { before: string; accel: string; after: string } {
  const idx = label.toLowerCase().indexOf(accelerator.toLowerCase());
  if (idx < 0) {
    return { before: "", accel: label.slice(0, 1), after: label.slice(1) };
  }
  return {
    before: label.slice(0, idx),
    accel: label.slice(idx, idx + 1),
    after: label.slice(idx + 1),
  };
}

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

export function Tabs({
  activeTab,
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
        const { before, accel, after } = splitLabelAtAccelerator(
          tab.label,
          tab.accelerator,
        );

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
              {before}
              <Text underline>{accel}</Text>
              {after}
              {countText}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
