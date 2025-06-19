import { Activity, ChevronDown, Trash2 } from "lucide-react";
import { RequestHistoryInfo } from "@/hooks/helpers/types";
import RequestHistoryItem from "./RequestHistoryItem";

interface ActivityTabProps {
  requestHistory: RequestHistoryInfo[];
  onClearHistory: () => void;
  onToggleCollapse?: () => void;
  showHeader?: boolean;
}

// Helper function to format request count
const formatRequestCount = (count: number): string => {
  return `${count} request${count !== 1 ? "s" : ""}`;
};

// Component for the clear history button
const ClearHistoryButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={onClick}
    className="p-2 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-all duration-200 group"
    title="Clear all activity"
  >
    <Trash2 className="w-4 h-4 text-muted-foreground group-hover:text-destructive" />
  </button>
);

// Component for the request count badge
const RequestCountBadge = ({ count }: { count: number }) => (
  <span className="text-sm text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
    {formatRequestCount(count)}
  </span>
);

// Component for the collapse toggle button
const CollapseToggleButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={onClick}
    className="p-2 rounded-lg hover:bg-accent/50 transition-all duration-200"
  >
    <ChevronDown className="w-5 h-5 text-muted-foreground hover:text-foreground" />
  </button>
);

// Component for the main header
const ActivityHeader = ({
  requestHistory,
  onClearHistory,
  onToggleCollapse,
}: {
  requestHistory: RequestHistoryInfo[];
  onClearHistory: () => void;
  onToggleCollapse?: () => void;
}) => (
  <div className="flex items-center justify-between mb-6">
    <h2 className="text-lg font-bold text-foreground flex items-center space-x-2">
      <Activity className="w-5 h-5 text-primary" />
      <span>All Activity</span>
    </h2>
    <div className="flex items-center space-x-3">
      {requestHistory.length > 0 && (
        <>
          <RequestCountBadge count={requestHistory.length} />
          <ClearHistoryButton onClick={onClearHistory} />
        </>
      )}
      {onToggleCollapse && <CollapseToggleButton onClick={onToggleCollapse} />}
    </div>
  </div>
);

// Component for the compact header (when showHeader is false)
const CompactHeader = ({
  requestHistory,
  onClearHistory,
}: {
  requestHistory: RequestHistoryInfo[];
  onClearHistory: () => void;
}) => (
  <div className="flex items-center justify-between mb-6">
    <RequestCountBadge count={requestHistory.length} />
    <ClearHistoryButton onClick={onClearHistory} />
  </div>
);

// Component for the empty state
const EmptyState = () => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <Activity className="w-12 h-12 text-muted-foreground/40 mb-4" />
    <p className="text-muted-foreground text-lg font-medium mb-2">
      No activity yet
    </p>
    <p className="text-muted-foreground/60 text-sm">
      MCP requests and responses will appear here
    </p>
  </div>
);

// Component for the request history list
const RequestHistoryList = ({
  requestHistory,
}: {
  requestHistory: RequestHistoryInfo[];
}) => (
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
);

const ActivityTab = ({
  requestHistory,
  onClearHistory,
  onToggleCollapse,
  showHeader = true,
}: ActivityTabProps) => {
  return (
    <div
      className={`flex-1 overflow-y-auto ${showHeader ? "p-6 border-r border-border/20" : ""}`}
    >
      {showHeader && (
        <ActivityHeader
          requestHistory={requestHistory}
          onClearHistory={onClearHistory}
          onToggleCollapse={onToggleCollapse}
        />
      )}

      {requestHistory.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {!showHeader && requestHistory.length > 0 && (
            <CompactHeader
              requestHistory={requestHistory}
              onClearHistory={onClearHistory}
            />
          )}
          <RequestHistoryList requestHistory={requestHistory} />
        </>
      )}
    </div>
  );
};

export default ActivityTab;
