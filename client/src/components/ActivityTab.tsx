import { Activity, ChevronDown, Trash2 } from "lucide-react";
import RequestHistoryItem from "./RequestHistoryItem";

interface ActivityTabProps {
  requestHistory: Array<{ request: string; response?: string; timestamp: string }>;
  onClearHistory: () => void;
  onToggleCollapse?: () => void;
  showHeader?: boolean;
}

const ActivityTab = ({ 
  requestHistory, 
  onClearHistory, 
  onToggleCollapse,
  showHeader = true 
}: ActivityTabProps) => {
  return (
    <div className={`flex-1 overflow-y-auto ${showHeader ? 'p-6 border-r border-border/20' : ''}`}>
      {showHeader && (
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-foreground flex items-center space-x-2">
            <Activity className="w-5 h-5 text-primary" />
            <span>All Activity</span>
          </h2>
          <div className="flex items-center space-x-3">
            {requestHistory.length > 0 && (
              <>
                <span className="text-sm text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                  {requestHistory.length} request
                  {requestHistory.length !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={onClearHistory}
                  className="p-2 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-all duration-200 group"
                  title="Clear all activity"
                >
                  <Trash2 className="w-4 h-4 text-muted-foreground group-hover:text-destructive" />
                </button>
              </>
            )}
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="p-2 rounded-lg hover:bg-accent/50 transition-all duration-200"
              >
                <ChevronDown className="w-5 h-5 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>
        </div>
      )}

      {requestHistory.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Activity className="w-12 h-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground text-lg font-medium mb-2">
            No activity yet
          </p>
          <p className="text-muted-foreground/60 text-sm">
            MCP requests and responses will appear here
          </p>
        </div>
      ) : (
        <>
          {!showHeader && requestHistory.length > 0 && (
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                {requestHistory.length} request{requestHistory.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={onClearHistory}
                className="p-2 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-all duration-200 group"
                title="Clear all activity"
              >
                <Trash2 className="w-4 h-4 text-muted-foreground group-hover:text-destructive" />
              </button>
            </div>
          )}
          <ul className="space-y-4">
            {requestHistory
              .slice()
              .reverse()
              .map((request, index) => (
                <RequestHistoryItem
                  key={index}
                  request={request}
                  index={index}
                  totalRequests={requestHistory.length}
                />
              ))}
          </ul>
        </>
      )}
    </div>
  );
};

export default ActivityTab; 