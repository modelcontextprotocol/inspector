import { ChevronDown, ScrollText } from "lucide-react";
import { CompatibilityCallToolResult } from "@modelcontextprotocol/sdk/types.js";
import ToolResult from "./ToolResult";

interface ResultsTabProps {
  toolResult: CompatibilityCallToolResult | null;
  onToggleCollapse?: () => void;
  showHeader?: boolean;
}

const ResultsTab = ({
  toolResult,
  onToggleCollapse,
  showHeader = true,
}: ResultsTabProps) => {
  return (
    <div className={`flex-1 overflow-y-auto ${showHeader ? "p-6" : ""}`}>
      {showHeader && (
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-foreground flex items-center space-x-2">
            <ScrollText className="w-5 h-5 text-primary" />
            <span>Results</span>
          </h2>
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="p-2 rounded-lg hover:bg-accent/50 transition-all duration-200"
            >
              <ChevronDown className="w-5 h-5 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
      )}

      {!toolResult ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-full bg-muted/20 flex items-center justify-center mb-4">
            <span className="text-2xl">🎯</span>
          </div>
          <p className="text-muted-foreground text-lg font-medium mb-2">
            No results yet
          </p>
          <p className="text-muted-foreground/60 text-sm">
            Tool execution results will appear here
          </p>
        </div>
      ) : (
        <div className="bg-gradient-to-br from-background/80 to-background/60 backdrop-blur-sm p-4 rounded-xl border border-border/30">
          <ToolResult toolResult={toolResult} />
        </div>
      )}
    </div>
  );
};

export default ResultsTab;
