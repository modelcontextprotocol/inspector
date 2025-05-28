import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bell,
  Files,
  FolderTree,
  Hammer,
  Hash,
  Key,
  MessageSquare,
  Bot,
  Settings,
} from "lucide-react";
import { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";
import useTheme from "../lib/hooks/useTheme";
import { version } from "../../../package.json";
import { PendingRequest } from "./SamplingTab";

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
  serverCapabilities?: ServerCapabilities | null;
  pendingSampleRequests: PendingRequest[];
  shouldDisableAll: boolean;
}

const Sidebar = ({
  currentPage,
  onPageChange,
  serverCapabilities,
  pendingSampleRequests,
  shouldDisableAll,
}: SidebarProps) => {
  const [theme, setTheme] = useTheme();

  const handlePageChange = (page: string) => {
    onPageChange(page);
    window.location.hash = page;
  };

  // Determine which logo to show based on theme
  const getLogoSrc = () => {
    if (theme === "dark") {
      return "/mcp_jam_dark.png";
    } else if (theme === "light") {
      return "/mcp_jam_light.png";
    } else {
      // For system theme, check if dark mode is active
      const isDarkMode = document.documentElement.classList.contains("dark");
      return isDarkMode ? "/mcp_jam_dark.png" : "/mcp_jam_light.png";
    }
  };

  const tabs = [
    {
      id: "tools",
      label: "Tools",
      icon: Hammer,
      disabled: !serverCapabilities?.tools || shouldDisableAll,
    },
    {
      id: "chat",
      label: "Chat",
      icon: Bot,
      disabled: shouldDisableAll,
    },
    {
      id: "ping",
      label: "Ping",
      icon: Bell,
      disabled: shouldDisableAll,
    },
    {
      id: "resources",
      label: "Resources",
      icon: Files,
      disabled: !serverCapabilities?.resources || shouldDisableAll,
    },
    {
      id: "prompts",
      label: "Prompts",
      icon: MessageSquare,
      disabled: !serverCapabilities?.prompts || shouldDisableAll,
    },
    {
      id: "sampling",
      label: "Sampling",
      icon: Hash,
      disabled: shouldDisableAll,
      badge:
        pendingSampleRequests.length > 0
          ? pendingSampleRequests.length
          : undefined,
    },
    {
      id: "roots",
      label: "Roots",
      icon: FolderTree,
      disabled: shouldDisableAll,
    },
    {
      id: "auth",
      label: "Auth",
      icon: Key,
      disabled: shouldDisableAll,
    },
    {
      id: "settings",
      label: "Settings",
      icon: Settings,
      disabled: shouldDisableAll,
    },
  ];

  return (
    <div className="w-80 bg-card border-r border-border flex flex-col h-full">
      {/* Logo and Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex flex-col items-center space-y-2">
          {/* MCP Jam Logo */}
          <div className="w-full flex justify-center">
            <img
              src={getLogoSrc()}
              alt="MCP Jam"
              className="h-6 w-auto object-contain transition-opacity duration-200"
              onError={(e) => {
                console.warn("Failed to load MCP Jam logo");
                e.currentTarget.style.display = "none";
              }}
            />
          </div>

          {/* Title */}
          <div className="text-center">
            <p className="text-xs text-muted-foreground opacity-70">
              v{version}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 flex-1 overflow-auto">
        <div className="space-y-2">
          {tabs.map((tab) => {
            const IconComponent = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => handlePageChange(tab.id)}
                disabled={tab.disabled}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-left relative ${
                  currentPage === tab.id
                    ? "bg-muted/100 text-foreground border border-border/50"
                    : "hover:bg-muted/30 text-muted-foreground hover:text-foreground"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <IconComponent className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{tab.label}</span>
                {tab.badge && (
                  <span className="bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center animate-pulse">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4 border-t">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Theme</span>
          <Select
            value={theme}
            onValueChange={(value: string) =>
              setTheme(value as "system" | "light" | "dark")
            }
          >
            <SelectTrigger className="w-[100px]" id="theme-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
