import React, { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

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

interface JsonRpcMessage {
  jsonrpc: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface TransportLogEntry {
  type: string;
  timestamp: number;
  streamId?: string;
  message?: string;
  body?: JsonRpcMessage | Record<string, unknown>;
  data?: JsonRpcMessage | Record<string, unknown>;
  id?: string | number;
  isSSE?: boolean;
  isRequest?: boolean;
  reason?: string;
  error?: boolean;
  event?: string;
  statusCode?: number;
  [key: string]: unknown;
}

interface ToolEvent {
  id: string | number;
  name: string;
  requestTime: number; 
  responseTime?: number;
  duration?: number;
  viaSSE: boolean;
  status: 'pending' | 'completed' | 'error';
  request: JsonRpcMessage | Record<string, unknown>;
  response?: JsonRpcMessage | Record<string, unknown>;
  error?: string;
}

interface TransportWithStats {
  getTransportStats(): TransportStats;
  registerLogCallback?(callback: (log: TransportLogEntry) => void): void;
  getActiveStreams?(): string[];
}

interface StreamableHttpStatsProps {
  mcpClient: unknown;
}

const StreamableHttpStats: React.FC<StreamableHttpStatsProps> = ({ mcpClient }) => {
  const [stats, setStats] = useState<TransportStats | null>(null);
  const [logs, setLogs] = useState<TransportLogEntry[]>([]);
  const [activeStreams, setActiveStreams] = useState<string[]>([]);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [httpStatus, setHttpStatus] = useState<Record<string, number>>({});
  const [specViolations, setSpecViolations] = useState<string[]>([]);
  const transportRef = useRef<TransportWithStats | null>(null);
  const logCallbackRegistered = useRef(false);

  const processToolLogs = (logs: TransportLogEntry[]) => {
    const toolCalls: ToolEvent[] = [];
    
    const toolRequests = logs.filter(log => {
      const body = log.body as Record<string, unknown> | undefined;
      return log.type === 'request' && 
        body && 
        typeof body === 'object' && 
        'method' in body && 
        body.method === 'tools/call' &&
        'id' in body;
    });
    
    toolRequests.forEach(request => {
      const body = request.body as Record<string, unknown> | undefined;
      if (!body || !('id' in body) || !('params' in body)) return;
      
      const requestId = body.id as string | number;
      const params = body.params as Record<string, unknown> | undefined;
      const toolName = params?.name as string || 'unknown';
      
      const responseLog = logs.find(log => {
        const data = log.data as Record<string, unknown> | undefined;
        return (log.type === 'response' || log.type === 'sseMessage') && 
          data && 
          typeof data === 'object' && 
          'id' in data && 
          data.id === requestId;
      });
      
      const responseData = responseLog?.data as Record<string, unknown> | undefined;
      
      const toolEvent: ToolEvent = {
        id: requestId,
        name: toolName,
        requestTime: request.timestamp,
        responseTime: responseLog?.timestamp,
        duration: responseLog ? responseLog.timestamp - request.timestamp : undefined,
        viaSSE: responseLog?.type === 'sseMessage' || false,
        status: responseLog 
          ? (responseData && 'error' in responseData ? 'error' : 'completed') 
          : 'pending',
        request: body,
        response: responseData,
        error: responseData && 'error' in responseData 
          ? JSON.stringify(responseData.error) 
          : undefined
      };
      
      toolCalls.push(toolEvent);
    });
    
    return toolCalls;
  };

  const checkSpecViolations = (logs: TransportLogEntry[], stats: TransportStats) => {
    const violations: string[] = [];
    
    if (httpStatus['404'] && httpStatus['404'] > 0) {
      if (stats.sessionId) {
        violations.push("Session expired or not recognized (HTTP 404) while using a valid session ID");
      }
    }
    
    if (httpStatus['405'] && httpStatus['405'] > 0) {
      violations.push("Server returned HTTP 405 - Method Not Allowed. Server must support both GET and POST methods.");
    }
    
    const notificationLogs = logs.filter(log => {
      const body = log.body as Record<string, unknown> | undefined;
      return log.type === 'request' && 
        body && 
        typeof body === 'object' && 
        'method' in body && 
        !('id' in body);
    });
    
    notificationLogs.forEach(log => {
      const relatedResponse = logs.find(l => 
        l.type === 'response' && 
        l.timestamp > log.timestamp && 
        l.timestamp - log.timestamp < 1000
      );
      
      if (relatedResponse && relatedResponse.statusCode !== 202) {
        violations.push(`Notification response had status ${relatedResponse.statusCode}, expected 202 Accepted`);
      }
    });
    
    const errorResponseLogs = logs.filter(log => {
      const data = log.data as Record<string, unknown> | undefined;
      return (log.type === 'response' || log.type === 'sseMessage') && 
        data && 
        typeof data === 'object' && 
        'error' in data;
    });
    
    if (errorResponseLogs.length > 0) {
      violations.push(`Found ${errorResponseLogs.length} JSON-RPC error responses`);
    }
    
    return violations;
  };

  useEffect(() => {
    const fetchStats = () => {
      if (!mcpClient) return;
      
      try {
        const client = mcpClient as unknown as { _transport?: unknown };
        const transport = client._transport as unknown as TransportWithStats;
        
        if (transport && typeof transport.getTransportStats === 'function') {
          transportRef.current = transport;
          const transportStats = transport.getTransportStats();
          setStats(transportStats);
          
          if (transport.getActiveStreams && typeof transport.getActiveStreams === 'function') {
            setActiveStreams(transport.getActiveStreams());
          }
          
          if (transport.registerLogCallback && typeof transport.registerLogCallback === 'function' && !logCallbackRegistered.current) {
            transport.registerLogCallback((logEntry: TransportLogEntry) => {
              setLogs(prevLogs => {
                const newLogs = [...prevLogs, logEntry];
                
                const updatedToolEvents = processToolLogs(newLogs);
                setToolEvents(updatedToolEvents);
                
                if (logEntry.type === 'response' && typeof logEntry.statusCode === 'number') {
                  const statusCodeStr = logEntry.statusCode.toString();
                  setHttpStatus(prev => ({
                    ...prev,
                    [statusCodeStr]: (prev[statusCodeStr] || 0) + 1
                  }));
                }
                
                if (transportStats) {
                  const violations = checkSpecViolations(newLogs, transportStats);
                  setSpecViolations(violations);
                }
                
                return newLogs.slice(-100);
              });
            });
            logCallbackRegistered.current = true;
          }
        }
      } catch (error) {
        console.error("Error fetching transport stats:", error);
      }
    };

    fetchStats();
    
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

  const formatJson = (data: unknown) => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return 'Unable to format data';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500';
      case 'completed': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="tools">
          Tool Calls
          <Badge variant="outline" className="ml-2">{toolEvents.length}</Badge>
        </TabsTrigger>
        <TabsTrigger value="streams">
          SSE Streams
          <Badge variant="outline" className="ml-2">{activeStreams.length}</Badge>
        </TabsTrigger>
        <TabsTrigger value="logs">
          Event Logs 
          <Badge variant="outline" className="ml-2">{logs.length}</Badge>
        </TabsTrigger>
        <TabsTrigger value="compliance">
          Compliance
          {specViolations.length > 0 && (
            <Badge variant="destructive" className="ml-2">{specViolations.length}</Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4">
        <div className="grid grid-cols-2 gap-1 text-xs">
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

        <div className="text-xs text-muted-foreground">
          <span 
            className={`inline-block w-2 h-2 rounded-full mr-1 ${
              stats.activeSSEConnections > 0 ? "bg-green-500" : "bg-gray-500"
            }`}
          />
          {stats.activeSSEConnections > 0 ? "SSE Stream Active" : "No Active SSE Stream"}
        </div>
        
        {Object.keys(httpStatus).length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm font-semibold mb-2">HTTP Status Codes</h4>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {Object.entries(httpStatus).map(([code, count]) => (
                <React.Fragment key={code}>
                  <div className="text-muted-foreground">HTTP {code}:</div>
                  <div>{count}</div>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value="tools" className="space-y-4">
        {toolEvents.length === 0 ? (
          <div className="text-sm text-muted-foreground">No tool calls detected yet.</div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-5 gap-2 text-xs font-semibold border-b pb-2">
              <div>Tool Name</div>
              <div>Request Time</div>
              <div>Duration</div>
              <div>Transport</div>
              <div>Status</div>
            </div>
            
            {toolEvents.map(tool => (
              <Accordion type="single" collapsible key={`${tool.id}`} className="w-full">
                <AccordionItem value={`tool-${tool.id}`}>
                  <div className="grid grid-cols-5 gap-2 text-xs items-center">
                    <AccordionTrigger className="hover:no-underline p-0 m-0">
                      {tool.name}
                    </AccordionTrigger>
                    <div>{formatTime(tool.requestTime)}</div>
                    <div>{tool.duration ? `${tool.duration}ms` : 'Pending'}</div>
                    <div>
                      <Badge variant={tool.viaSSE ? "outline" : "default"}>
                        {tool.viaSSE ? 'SSE' : 'HTTP JSON'}
                      </Badge>
                    </div>
                    <div>
                      <span className={`px-2 py-1 rounded text-white ${getStatusColor(tool.status)}`}>
                        {tool.status.charAt(0).toUpperCase() + tool.status.slice(1)}
                      </span>
                    </div>
                  </div>
                  <AccordionContent>
                    <div className="mt-2 space-y-2">
                      <div>
                        <h4 className="text-xs font-semibold">Request:</h4>
                        <pre className="text-xs bg-muted p-2 rounded-md overflow-auto max-h-40">
                          {formatJson(tool.request)}
                        </pre>
                      </div>
                      {tool.response && (
                        <div>
                          <h4 className="text-xs font-semibold">Response:</h4>
                          <pre className="text-xs bg-muted p-2 rounded-md overflow-auto max-h-40">
                            {formatJson(tool.response)}
                          </pre>
                        </div>
                      )}
                      {tool.error && (
                        <div>
                          <h4 className="text-xs font-semibold text-red-500">Error:</h4>
                          <pre className="text-xs bg-red-50 p-2 rounded-md overflow-auto max-h-40">
                            {tool.error}
                          </pre>
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="streams" className="space-y-4">
        {activeStreams.length === 0 ? (
          <div className="text-sm text-muted-foreground">No active SSE streams.</div>
        ) : (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Active SSE Streams ({activeStreams.length})</h4>
            <div className="grid grid-cols-1 gap-2">
              {activeStreams.map(streamId => (
                <div key={streamId} className="p-2 border rounded-md bg-muted/20">
                  <div className="flex justify-between items-center">
                    <div className="text-xs font-mono">{streamId}</div>
                    <Badge variant="outline" className="bg-green-50">Active</Badge>
                  </div>
                  
                  {/* Show messages for this stream */}
                  <div className="mt-2">
                    <div className="text-xs text-muted-foreground">
                      {logs.filter(log => log.streamId === streamId).length} messages
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="mt-4">
          <h4 className="text-sm font-semibold">Stream Events</h4>
          {logs.filter(log => log.type === 'sseOpen' || log.type === 'sseClose').length === 0 ? (
            <div className="text-sm text-muted-foreground">No stream events detected yet.</div>
          ) : (
            <div className="space-y-1 text-xs">
              {logs
                .filter(log => log.type === 'sseOpen' || log.type === 'sseClose')
                .map((log, index) => (
                  <div key={index} className="p-2 border rounded-md">
                    <div className="flex justify-between items-center">
                      <Badge variant={log.type === 'sseOpen' ? "default" : "secondary"}>
                        {log.type === 'sseOpen' ? 'Stream Opened' : 'Stream Closed'}
                      </Badge>
                      <div>{formatTime(log.timestamp)}</div>
                    </div>
                    <div className="mt-1">
                      {log.streamId && <div>Stream ID: {log.streamId}</div>}
                      {log.reason && <div>Reason: {log.reason}</div>}
                      {log.isRequest && <div>Initiated by request: Yes</div>}
                    </div>
                  </div>
                ))
                .reverse()
              }
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="logs" className="space-y-4">
        <div className="mb-2 flex justify-between items-center">
          <h4 className="text-sm font-semibold">Transport Event Log</h4>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setLogs([])}
            className="text-xs"
          >
            Clear Logs
          </Button>
        </div>
        
        {logs.length === 0 ? (
          <div className="text-sm text-muted-foreground">No logs captured yet.</div>
        ) : (
          <div className="space-y-1 text-xs h-[400px] overflow-y-auto">
            {logs.map((log, index) => (
              <div 
                key={index} 
                className={`p-2 border rounded-md ${
                  log.error ? 'border-red-300 bg-red-50' : 
                  log.type === 'request' ? 'border-blue-300 bg-blue-50' : 
                  log.type === 'response' ? 'border-green-300 bg-green-50' : 
                  log.type === 'sseMessage' ? 'border-purple-300 bg-purple-50' : 
                  'border-gray-300'
                }`}
              >
                <div className="flex justify-between items-center">
                  <Badge variant="outline">
                    {log.type}
                    {log.isSSE && ' (SSE)'}
                  </Badge>
                  <div className="text-xs text-muted-foreground">{formatTime(log.timestamp)}</div>
                </div>
                
                {log.streamId && (
                  <div className="mt-1">Stream: {log.streamId}</div>
                )}
                
                {log.id && (
                  <div className="mt-1">ID: {String(log.id)}</div>
                )}
                
                {log.message && (
                  <div className="mt-1">{log.message}</div>
                )}
                
                {(log.body || log.data) && (
                  <Accordion type="single" collapsible className="w-full mt-1">
                    <AccordionItem value={`log-${index}`}>
                      <AccordionTrigger className="text-xs py-1">Show Content</AccordionTrigger>
                      <AccordionContent>
                        <pre className="text-xs bg-muted p-2 rounded-md overflow-auto max-h-40">
                          {formatJson(log.body || log.data)}
                        </pre>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
              </div>
            )).reverse()}
          </div>
        )}
      </TabsContent>

      <TabsContent value="compliance" className="space-y-4">
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Spec Compliance Checks</h4>
          
          {specViolations.length > 0 ? (
            <div className="space-y-2">
              <div className="p-3 bg-red-50 border border-red-300 rounded-md">
                <h5 className="font-semibold text-red-700">Detected Violations</h5>
                <ul className="mt-2 pl-5 list-disc text-sm space-y-1">
                  {specViolations.map((violation, index) => (
                    <li key={index} className="text-red-600">{violation}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-green-50 border border-green-300 rounded-md">
              <p className="text-green-700">No spec violations detected.</p>
            </div>
          )}
          
          <div className="mt-4">
            <h5 className="text-sm font-semibold mb-2">Spec Compliance Checklist</h5>
            <div className="space-y-2">
              <div className="p-2 border rounded-md">
                <div className="flex items-center">
                  <span className={`inline-block w-3 h-3 rounded-full mr-2 ${
                    stats.sessionId ? "bg-green-500" : "bg-gray-300"
                  }`}></span>
                  <span className="text-sm">Session Management</span>
                </div>
                <p className="text-xs text-muted-foreground ml-5 mt-1">
                  {stats.sessionId 
                    ? `Using session ID: ${stats.sessionId}` 
                    : "Not using session management"}
                </p>
              </div>
              
              <div className="p-2 border rounded-md">
                <div className="flex items-center">
                  <span className={`inline-block w-3 h-3 rounded-full mr-2 ${
                    stats.activeSSEConnections > 0 ? "bg-green-500" : "bg-yellow-500"
                  }`}></span>
                  <span className="text-sm">Server-Sent Events</span>
                </div>
                <p className="text-xs text-muted-foreground ml-5 mt-1">
                  {stats.activeSSEConnections > 0 
                    ? `${stats.activeSSEConnections} active SSE connections` 
                    : "No active SSE connections"}
                </p>
              </div>
              
              <div className="p-2 border rounded-md">
                <div className="flex items-center">
                  <span className={`inline-block w-3 h-3 rounded-full mr-2 ${
                    stats.pendingRequests === 0 ? "bg-green-500" : "bg-yellow-500"
                  }`}></span>
                  <span className="text-sm">Request-Response Handling</span>
                </div>
                <p className="text-xs text-muted-foreground ml-5 mt-1">
                  {stats.pendingRequests === 0 
                    ? "All requests have received responses" 
                    : `${stats.pendingRequests} pending requests without responses`}
                </p>
              </div>
              
              <div className="p-2 border rounded-md">
                <div className="flex items-center">
                  <span className={`inline-block w-3 h-3 rounded-full mr-2 ${
                    toolEvents.length > 0 ? "bg-green-500" : "bg-gray-300"
                  }`}></span>
                  <span className="text-sm">Tool Call Flow</span>
                </div>
                <p className="text-xs text-muted-foreground ml-5 mt-1">
                  {toolEvents.length > 0 
                    ? `${toolEvents.length} tool calls tracked` 
                    : "No tool calls detected"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
};

export default StreamableHttpStats; 
