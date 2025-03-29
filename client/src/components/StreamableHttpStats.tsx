import React, { useEffect, useState } from "react";

// Define the shape of the transport stats
interface TransportStats {
  sessionId?: string;
  lastRequestTime: number;
  lastResponseTime: number;
  requestCount: number;
  responseCount: number;
  sseConnectionCount: number;
  activeSSEConnections: number;
  receivedMessages: number;
  pendingRequests: number;
  connectionEstablished: boolean;
}

interface TransportWithStats {
  getTransportStats(): TransportStats;
}

interface StreamableHttpStatsProps {
  mcpClient: unknown;
}

const StreamableHttpStats: React.FC<StreamableHttpStatsProps> = ({ mcpClient }) => {
  const [stats, setStats] = useState<TransportStats | null>(null);

  useEffect(() => {
    const fetchStats = () => {
      if (!mcpClient) return;
      
      try {
        // Access private _transport property using type cast
        const client = mcpClient as unknown as { _transport?: unknown };
        const transport = client._transport as unknown as TransportWithStats;
        
        if (transport && typeof transport.getTransportStats === 'function') {
          const transportStats = transport.getTransportStats();
          setStats(transportStats);
        }
      } catch (error) {
        console.error("Error fetching transport stats:", error);
      }
    };

    fetchStats();
    
    // Refresh stats every 2 seconds
    const interval = setInterval(fetchStats, 2000);
    
    return () => clearInterval(interval);
  }, [mcpClient]);

  if (!stats) {
    return <div className="text-xs text-muted-foreground">No stats available</div>;
  }

  const formatTime = (timestamp: number) => {
    if (!timestamp) return "Never";
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const calcLatency = () => {
    if (stats.lastRequestTime && stats.lastResponseTime) {
      const latency = stats.lastResponseTime - stats.lastRequestTime;
      return `${latency}ms`;
    }
    return "N/A";
  };

  return (
    <div className="space-y-1 text-xs">
      <div className="grid grid-cols-2 gap-1">
        <div className="text-muted-foreground">Session ID:</div>
        <div className="truncate font-mono">{stats.sessionId || "None"}</div>
        
        <div className="text-muted-foreground">Connection:</div>
        <div>{stats.connectionEstablished ? "Established" : "Not established"}</div>
        
        <div className="text-muted-foreground">Requests:</div>
        <div>{stats.requestCount}</div>
        
        <div className="text-muted-foreground">Responses:</div>
        <div>{stats.responseCount}</div>
        
        <div className="text-muted-foreground">Messages Received:</div>
        <div>{stats.receivedMessages}</div>
        
        <div className="text-muted-foreground">SSE Connections:</div>
        <div>{stats.activeSSEConnections} active / {stats.sseConnectionCount} total</div>
        
        <div className="text-muted-foreground">Pending Requests:</div>
        <div>{stats.pendingRequests}</div>
        
        <div className="text-muted-foreground">Last Request:</div>
        <div>{formatTime(stats.lastRequestTime)}</div>
        
        <div className="text-muted-foreground">Last Response:</div>
        <div>{formatTime(stats.lastResponseTime)}</div>
        
        <div className="text-muted-foreground">Last Latency:</div>
        <div>{calcLatency()}</div>
      </div>

      <div className="mt-2 text-muted-foreground">
        <span 
          className={`inline-block w-2 h-2 rounded-full mr-1 ${
            stats.activeSSEConnections > 0 ? "bg-green-500" : "bg-gray-500"
          }`}
        />
        {stats.activeSSEConnections > 0 ? "SSE Stream Active" : "No Active SSE Stream"}
      </div>
    </div>
  );
};

export default StreamableHttpStats; 
