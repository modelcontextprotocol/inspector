import { CompatibilityCallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { useEffect, useState } from "react";
import { Activity, ScrollText, ChevronDown } from "lucide-react";
import ActivityTab from "./ActivityTab";
import ResultsTab from "./ResultsTab";

interface TabbedHistoryPanelProps {
  requestHistory: Array<{
    request: string;
    response?: string;
    timestamp: string;
    latency?: number;
  }>;
  toolResult: CompatibilityCallToolResult | null;
  onClearHistory: () => void;
  onToggleCollapse: () => void;
}

type TabType = "activity" | "results";

const TabbedHistoryPanel = ({
  requestHistory,
  toolResult,
  onClearHistory,
  onToggleCollapse,
}: TabbedHistoryPanelProps) => {
  const [activeTab, setActiveTab] = useState<TabType>("activity");

  useEffect(() => {
    if (toolResult) {
      setActiveTab("results");
    }
  }, [toolResult]);

  const tabs = [
    {
      id: "activity" as TabType,
      label: "Activity",
      icon: Activity,
      count: requestHistory.length,
    },
    {
      id: "results" as TabType,
      label: "Results",
      icon: ScrollText,
      hasContent: !!toolResult,
    },
  ];

  return (
    <div className="bg-transparent flex flex-col h-full">
      {/* Tab Headers */}
      <div className="flex items-center justify-between border-b border-border/20 px-6 py-3">
        <div className="flex space-x-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium">{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="px-2 py-1 text-xs bg-primary/10 text-primary rounded-full">
                    {tab.count}
                  </span>
                )}
                {tab.hasContent && (
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={onToggleCollapse}
          className="p-2 rounded-lg hover:bg-accent/50 transition-all duration-200"
        >
          <ChevronDown className="w-5 h-5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "activity" && (
          <div className="h-full overflow-y-auto p-6">
            <ActivityTab
              requestHistory={requestHistory}
              onClearHistory={onClearHistory}
              showHeader={false}
            />
          </div>
        )}
        {activeTab === "results" && (
          <div className="h-full overflow-y-auto p-6">
            <ResultsTab toolResult={toolResult} showHeader={false} />
          </div>
        )}
      </div>
    </div>
  );
};

export default TabbedHistoryPanel;
