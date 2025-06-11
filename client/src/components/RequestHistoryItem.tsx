import { useState } from "react";
import JsonView from "./JsonView";

interface RequestHistoryItemProps {
  request: { request: string; response?: string };
  index: number;
  totalRequests: number;
}

const RequestHistoryItem = ({ request, index, totalRequests }: RequestHistoryItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpansion = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <li className="text-sm bg-gradient-to-r from-secondary/50 via-secondary/70 to-secondary/50 backdrop-blur-sm p-4 rounded-xl border border-border/30 hover:border-border/60 transition-all duration-200 hover:shadow-lg">
      <div
        className="flex justify-between items-center cursor-pointer group"
        onClick={toggleExpansion}
      >
        <div className="flex items-center space-x-3">
          <span className="flex items-center justify-center w-6 h-6 bg-primary/10 text-primary text-xs font-bold rounded-full">
            {totalRequests - index}
          </span>
          <span className="font-mono font-semibold text-foreground">
            {JSON.parse(request.request).method}
          </span>
        </div>
        <span className="text-muted-foreground group-hover:text-foreground transition-colors duration-200">
          {isExpanded ? "▼" : "▶"}
        </span>
      </div>
      {isExpanded && (
        <div className="mt-4 space-y-4">
          <div>
            <div className="flex items-center mb-2">
              <span className="font-semibold text-foreground text-sm">
                Request
              </span>
            </div>
            <JsonView
              data={request.request}
              className="bg-background/80 backdrop-blur-sm border border-border/20 rounded-lg"
            />
          </div>
          {request.response && (
            <div>
              <div className="flex items-center mb-2">
                <span className="font-semibold text-foreground text-sm">
                  Response
                </span>
              </div>
              <JsonView
                data={request.response}
                className="bg-background/80 backdrop-blur-sm border border-border/20 rounded-lg"
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
};

export default RequestHistoryItem; 