import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
export const tabs = [
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
}) {
  const visibleTabs = showLogging
    ? tabs
    : tabs.filter((tab) => tab.id !== "logging");
  return _jsx(Box, {
    width: width,
    borderStyle: "single",
    borderTop: false,
    borderLeft: false,
    borderRight: false,
    borderBottom: true,
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    paddingX: 1,
    children: visibleTabs.map((tab) => {
      const isActive = activeTab === tab.id;
      const count = counts[tab.id];
      const countText = count !== undefined ? ` (${count})` : "";
      const firstChar = tab.label[0];
      const restOfLabel = tab.label.slice(1);
      return _jsx(
        Box,
        {
          flexShrink: 0,
          children: _jsxs(Text, {
            bold: isActive,
            ...(isActive && focused
              ? {}
              : { color: isActive ? "cyan" : "gray" }),
            backgroundColor: isActive && focused ? "yellow" : undefined,
            children: [
              isActive ? "▶ " : "  ",
              _jsx(Text, { underline: true, children: firstChar }),
              restOfLabel,
              countText,
            ],
          }),
        },
        tab.id,
      );
    }),
  });
}
