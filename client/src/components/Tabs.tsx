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
import { PendingRequest } from "./SamplingTab";

interface TabsProps {
  currentPage: string;
  onPageChange: (page: string) => void;
  serverCapabilities?: ServerCapabilities | null;
  pendingSampleRequests: PendingRequest[];
  shouldDisableAll: boolean;
}

const Tabs = ({
  currentPage,
  onPageChange,
  serverCapabilities,
  pendingSampleRequests,
  shouldDisableAll,
}: TabsProps) => {
  const handlePageChange = (page: string) => {
    onPageChange(page);
    window.location.hash = page;
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
    <div className="bg-card border-b border-border flex flex-col w-full">
      {/* Horizontal Tabs */}
      <div className="px-4 py-2">
        <div className="flex items-center space-x-1 overflow-x-auto">
          {tabs.map((tab) => {
            const IconComponent = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => handlePageChange(tab.id)}
                disabled={tab.disabled}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 whitespace-nowrap relative min-w-fit ${
                  currentPage === tab.id
                    ? "bg-muted/100 text-foreground border border-border/50"
                    : "hover:bg-muted/30 text-muted-foreground hover:text-foreground"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <IconComponent className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm">{tab.label}</span>
                {tab.badge && (
                  <span className="bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center animate-pulse ml-1">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Tabs;
