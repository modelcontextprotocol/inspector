import { CompatibilityCallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { useEffect, useState } from "react";
import { History, ChevronDown } from "lucide-react";
import { useDraggablePane } from "../lib/hooks/useDraggablePane";
import TabbedHistoryPanel from "./TabbedHistoryPanel";

const HistoryAndNotifications = ({
  requestHistory,
  toolResult,
  onClearHistory,
}: {
  requestHistory: Array<{ request: string; response?: string }>;
  toolResult: CompatibilityCallToolResult | null;
  onClearHistory: () => void;
}) => {
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(true);

  const {
    height: historyPaneHeight,
    handleDragStart,
    resetHeight,
  } = useDraggablePane(isHistoryCollapsed ? 60 : 500);

  const toggleCollapse = () => {
    setIsHistoryCollapsed(!isHistoryCollapsed);
  };

  useEffect(() => {
    if (toolResult) {
      resetHeight();
      setIsHistoryCollapsed(false);
    }
  }, [toolResult, resetHeight]);

  return (
    <div
      className={`relative bg-gradient-to-r from-card/95 via-card to-card/95 backdrop-blur-md border-t border-border/30 transition-all duration-500 ease-out ${
        isHistoryCollapsed
          ? "shadow-lg shadow-black/5"
          : "shadow-2xl shadow-black/10"
      }`}
      style={{
        height: `${isHistoryCollapsed ? 60 : historyPaneHeight}px`,
      }}
    >
      {/* Simple Drag Handle */}
      <div
        className="absolute w-full h-2 -top-1 cursor-row-resize"
        onMouseDown={handleDragStart}
      />

      {/* Content */}
      <div className="h-full overflow-hidden">
        {!isHistoryCollapsed ? (
          <TabbedHistoryPanel
            requestHistory={requestHistory}
            toolResult={toolResult}
            onClearHistory={onClearHistory}
            onToggleCollapse={toggleCollapse}
          />
        ) : (
          <div
            className="h-full flex items-center justify-center bg-gradient-to-r from-muted/20 via-muted/30 to-muted/20 cursor-pointer hover:bg-gradient-to-r hover:from-muted/30 hover:via-muted/40 hover:to-muted/30 transition-all duration-200"
            onClick={toggleCollapse}
          >
            <div className="flex items-center space-x-4 text-muted-foreground">
              <History className="w-5 h-5" />
              <span className="text-sm font-medium">History & Results</span>
              {requestHistory.length > 0 && (
                <span className="px-2 py-1 text-xs bg-primary/10 text-primary rounded-full">
                  {requestHistory.length}
                </span>
              )}
              <ChevronDown className="w-4 h-4 rotate-180" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryAndNotifications;
