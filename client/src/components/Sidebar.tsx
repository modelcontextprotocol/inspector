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
}

const Sidebar = ({
  currentPage,
  onPageChange,
  serverCapabilities,
  pendingSampleRequests,
}: SidebarProps) => {
  const [theme, setTheme] = useTheme();

  const handlePageChange = (page: string) => {
    onPageChange(page);
    window.location.hash = page;
  };

  const tabs = [
    {
      id: "resources",
      label: "Resources",
      icon: Files,
      disabled: !serverCapabilities?.resources,
    },
    {
      id: "prompts",
      label: "Prompts",
      icon: MessageSquare,
      disabled: !serverCapabilities?.prompts,
    },
    {
      id: "tools",
      label: "Tools",
      icon: Hammer,
      disabled: !serverCapabilities?.tools,
    },
    {
      id: "chat",
      label: "Chat",
      icon: Bot,
      disabled: false,
    },
    {
      id: "ping",
      label: "Ping",
      icon: Bell,
      disabled: false,
    },
    {
      id: "sampling",
      label: "Sampling",
      icon: Hash,
      disabled: false,
      badge:
        pendingSampleRequests.length > 0
          ? pendingSampleRequests.length
          : undefined,
    },
    {
      id: "roots",
      label: "Roots",
      icon: FolderTree,
      disabled: false,
    },
    {
      id: "auth",
      label: "Auth",
      icon: Key,
      disabled: false,
    },
  ];

  return (
    <div className="w-80 bg-card border-r border-border flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center">
          <h1 className="ml-2 text-lg font-semibold">
            MCP Inspector v{version}
          </h1>
        </div>
      </div>

      <div className="p-4 flex-1 overflow-auto">
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Navigation
          </h2>
          {tabs.map((tab) => {
            const IconComponent = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => handlePageChange(tab.id)}
                disabled={tab.disabled}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-left relative ${
                  currentPage === tab.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-muted text-foreground"
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
