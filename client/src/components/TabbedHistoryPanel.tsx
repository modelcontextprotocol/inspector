import { CompatibilityCallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { useEffect, useState } from "react";
import { Activity, ScrollText, ChevronDown, Bug } from "lucide-react";
import ActivityTab from "./ActivityTab";
import ResultsTab from "./ResultsTab";
import ClientLogsTab from "./ClientLogsTab";
import { ClientLogInfo } from "@/hooks/helpers/types";

interface TabbedHistoryPanelProps {
  requestHistory: Array<{
    request: string;
    response?: string;
    timestamp: string;
    latency?: number;
  }>;
  toolResult: CompatibilityCallToolResult | null;
  clientLogs: ClientLogInfo[];
  onClearHistory: () => void;
  onClearLogs: () => void;
  onToggleCollapse: () => void;
}

type TabType = "activity" | "results" | "logs";

const TabbedHistoryPanel = ({
  requestHistory,
  toolResult,
  clientLogs,
  onClearHistory,
  onClearLogs,
  onToggleCollapse,
}: TabbedHistoryPanelProps) => {
  const [activeTab, setActiveTab] = useState<TabType>("activity");
  const [isToolResultError, setIsToolResultError] = useState(false);

  useEffect(() => {
    if (toolResult) {
      setIsToolResultError(toolResult.isError === true);
      setActiveTab("results");
    }
  }, [toolResult]);

  useEffect(() => {
    if (clientLogs.length > 0) {
      const isLastLogError =
        clientLogs[clientLogs.length - 1].level === "error";
      const isLastLogToolCall =
        clientLogs[clientLogs.length - 1].message.includes(
          "Error calling tool",
        ); // TODO: Fix this text check. not reliable.

      if (isLastLogError && !isLastLogToolCall) {
        setActiveTab("logs");
      }
    }
  }, [clientLogs]);

  const renderActivityTabButton = () => {
    return (
      <button
        key="activity"
        onClick={() => setActiveTab("activity")}
        className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 ${
          activeTab === "activity"
            ? "bg-primary/10 text-primary border border-primary/20"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
        }`}
      >
        <Activity className="w-4 h-4" />
        <span className="text-sm font-medium">Activity</span>
        {requestHistory.length > 0 && (
          <span className="px-2 py-1 text-xs bg-primary/10 text-primary rounded-full">
            {requestHistory.length}
          </span>
        )}
      </button>
    );
  };

  const renderResultsTabButton = () => {
    const renderCircleIndicator = () => {
      if (toolResult && !isToolResultError) {
        return <div className="w-2 h-2 bg-green-500 rounded-full"></div>;
      } else if (toolResult && isToolResultError) {
        return <div className="w-2 h-2 bg-red-500 rounded-full"></div>;
      } else {
        return null;
      }
    };
    return (
      <button
        key="results"
        onClick={() => setActiveTab("results")}
        className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 ${
          activeTab === "results"
            ? "bg-primary/10 text-primary border border-primary/20"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
        }`}
      >
        <ScrollText className="w-4 h-4" />
        <span className="text-sm font-medium">Results</span>
        {renderCircleIndicator()}
      </button>
    );
  };

  const renderLogsTabButton = () => {
    return (
      <button
        key="logs"
        onClick={() => setActiveTab("logs")}
        className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 ${
          activeTab === "logs"
            ? "bg-primary/10 text-primary border border-primary/20"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
        }`}
      >
        <Bug className="w-4 h-4" />
        <span className="text-sm font-medium">Logs</span>
        {clientLogs.length > 0 && (
          <span className="px-2 py-1 text-xs bg-primary/10 text-primary rounded-full">
            {clientLogs.length}
          </span>
        )}
      </button>
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "activity":
        return (
          <div className="h-full overflow-y-auto p-6">
            <ActivityTab
              requestHistory={requestHistory}
              onClearHistory={onClearHistory}
              showHeader={false}
            />
          </div>
        );
      case "results":
        return (
          <div className="h-full overflow-y-auto p-6">
            <ResultsTab toolResult={toolResult} showHeader={false} />
          </div>
        );
      case "logs":
        return (
          <div className="h-full overflow-y-auto p-6">
            <ClientLogsTab
              clientLogs={clientLogs}
              onClearLogs={onClearLogs}
              showHeader={false}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-transparent flex flex-col h-full">
      {/* Tab Headers */}
      <div className="flex items-center justify-between border-b border-border/20 px-6 py-3">
        <div className="flex space-x-1">
          {renderActivityTabButton()}
          {renderResultsTabButton()}
          {renderLogsTabButton()}
        </div>
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded-lg hover:bg-accent/50 transition-all duration-200"
        >
          <ChevronDown className="w-5 h-5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">{renderTabContent()}</div>
    </div>
  );
};

export default TabbedHistoryPanel;
