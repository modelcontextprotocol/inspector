import { useState } from "react";
import JsonView from "./JsonView";

interface RequestHistoryItemProps {
  request: { request: string; response?: string; timestamp: string; latency?: number };
  index: number;
  totalRequests: number;
}

const RequestHistoryItem = ({ request, index, totalRequests }: RequestHistoryItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpansion = () => {
    setIsExpanded(!isExpanded);
  };

  const requestData = JSON.parse(request.request);
  const requestNumber = totalRequests - index;
  
  // Format timestamp to display time like "12:26:05 AM"
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // Format latency to display like "214ms"
  const formatLatency = (latency?: number) => {
    if (latency === undefined) return undefined;
    return `${latency}ms`;
  };

  return (
    <article className="text-sm bg-gradient-to-r from-secondary/50 via-secondary/70 to-secondary/50 backdrop-blur-sm p-4 rounded-xl border border-border/30 hover:border-border/60 transition-all duration-200 hover:shadow-lg">
      <RequestHeader
        requestNumber={requestNumber}
        method={requestData.method}
        server={requestData.server}
        timestamp={formatTimestamp(request.timestamp)}
        latency={formatLatency(request.latency)}
        isExpanded={isExpanded}
        onToggle={toggleExpansion}
      />
      
      {isExpanded && (
        <RequestDetails
          requestData={request.request}
          responseData={request.response}
        />
      )}
    </article>
  );
};

interface RequestHeaderProps {
  requestNumber: number;
  method: string;
  server?: string;
  timestamp: string;
  latency?: string;
  isExpanded: boolean;
  onToggle: () => void;
}

const RequestHeader = ({ requestNumber, method, server, timestamp, latency, isExpanded, onToggle }: RequestHeaderProps) => (
  <header
    className="flex justify-between items-center cursor-pointer group"
    onClick={onToggle}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    }}
    aria-expanded={isExpanded}
    aria-label={`Request ${requestNumber}: ${method}`}
  >
    <RequestInfo requestNumber={requestNumber} method={method} server={server} timestamp={timestamp} latency={latency} />
    <ExpandIcon isExpanded={isExpanded} />
  </header>
);

interface RequestInfoProps {
  requestNumber: number;
  method: string;
  server?: string;
  timestamp: string;
  latency?: string;
}

const RequestInfo = ({ requestNumber, method, server, timestamp, latency }: RequestInfoProps) => (
  <div className="flex items-center space-x-3">
    <RequestBadge number={requestNumber} />
    <TimeStamp timestamp={timestamp} />
    <MethodLabel method={method} server={server} />
    {latency && (
      <span className="text-xs text-muted-foreground font-mono">
        {latency}
      </span>
    )}
  </div>
);

interface RequestBadgeProps {
  number: number;
}

const RequestBadge = ({ number }: RequestBadgeProps) => (
  <span 
    className="flex items-center justify-center w-6 h-6 bg-primary/10 text-primary text-xs font-bold rounded-full"
    aria-label={`Request number ${number}`}
  >
    {number}
  </span>
);

interface TimeStampProps {
  timestamp: string;
}

const TimeStamp = ({ timestamp }: TimeStampProps) => (
  <span className="text-xs text-muted-foreground font-mono">
    {timestamp}
  </span>
);

interface MethodLabelProps {
  method: string;
  server?: string;
}

const MethodLabel = ({ method, server }: MethodLabelProps) => (
  <span className="font-mono font-semibold text-foreground">
    {method}
    {server && ` (${server})`}
  </span>
);

interface ExpandIconProps {
  isExpanded: boolean;
}

const ExpandIcon = ({ isExpanded }: ExpandIconProps) => (
  <span 
    className="text-muted-foreground group-hover:text-foreground transition-colors duration-200"
    aria-hidden="true"
  >
    {isExpanded ? "▼" : "▶"}
  </span>
);

interface RequestDetailsProps {
  requestData: string;
  responseData?: string;
}

const RequestDetails = ({ requestData, responseData }: RequestDetailsProps) => (
  <section className="mt-4 space-y-4" aria-label="Request and response details">
    <RequestSection title="Request" data={requestData} />
    {responseData && (
      <RequestSection title="Response" data={responseData} />
    )}
  </section>
);

interface RequestSectionProps {
  title: string;
  data: string;
}

const RequestSection = ({ title, data }: RequestSectionProps) => (
  <div>
    <SectionHeader title={title} />
    <JsonView
      data={data}
      className="bg-background/80 backdrop-blur-sm border border-border/20 rounded-lg"
    />
  </div>
);

interface SectionHeaderProps {
  title: string;
}

const SectionHeader = ({ title }: SectionHeaderProps) => (
  <h3 className="flex items-center mb-2">
    <span className="font-semibold text-foreground text-sm">
      {title}
    </span>
  </h3>
);

export default RequestHistoryItem; 