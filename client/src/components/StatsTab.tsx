import { TabsContent } from "@/components/ui/tabs";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StreamableHttpStats from "./StreamableHttpStats";
import React, { useState, useEffect, useRef } from "react";
import { v4 as uuidv4 } from 'uuid';

// Event category for filtering
type EventCategory = "all" | "http" | "sse" | "errors";

interface StreamEvent {
  id: string;
  timestamp: string;
  content: string;
  type: "message" | "connection" | "error";
  streamId?: string;
  direction: "incoming" | "outgoing";
  category: EventCategory | "all"; // The primary category this event belongs to
}

// Define the structure for transport logs
interface TransportLogEntry {
  type: string;
  timestamp: number;
  streamId?: string;
  message?: string;
  body?: unknown;
  data?: unknown;
  isSSE?: boolean;
  isRequest?: boolean;
  reason?: string;
  error?: boolean;
  [key: string]: unknown;
}

interface TransportWithHandlers {
  onmessage?: (message: unknown) => void;
  onerror?: (error: Error) => void;
  getActiveStreams?: () => string[];
  registerLogCallback?: (callback: (log: TransportLogEntry) => void) => void;
  getTransportStats?: () => TransportStats;
  [key: string]: unknown;
}

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

interface ClientWithTransport {
  _transport?: TransportWithHandlers;
  [key: string]: unknown;
}

interface StatsTabProps {
  mcpClient: unknown;
}

// Track connection sequence steps
interface ConnectionStep {
  id: string;
  completed: boolean;
  timestamp: string | null;
  description: string;
}

const StatsTab: React.FC<StatsTabProps> = ({ mcpClient }) => {
  const [sseEvents, setSseEvents] = useState<StreamEvent[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<EventCategory>("all");
  const [activeStreamCount, setActiveStreamCount] = useState<number>(0);
  const [hasActiveConnection, setHasActiveConnection] = useState<boolean>(false);
  const [transportStats, setTransportStats] = useState<TransportStats | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  
  // Connection sequence tracking using unique IDs for each step
  const [connectionSteps, setConnectionSteps] = useState<ConnectionStep[]>([
    { id: 'step-1', completed: false, timestamp: null, description: "Client sends initialize request via HTTP POST" },
    { id: 'step-2', completed: false, timestamp: null, description: "Server responds with capabilities and session ID" },
    { id: 'step-3', completed: false, timestamp: null, description: "Client sends initialized notification" },
    { id: 'step-4', completed: false, timestamp: null, description: "Client establishes SSE connection via HTTP GET" },
    { id: 'step-5', completed: false, timestamp: null, description: "Normal request/response flow begins" }
  ]);

  // Keep track of whether we've already processed certain types of messages
  const processedMessages = useRef<Set<string>>(new Set());
  
  // Use a ref to track completed steps for immediate validation
  const completedStepsRef = useRef<Set<string>>(new Set());
  
  // Get filtered events based on selected category
  const filteredEvents = sseEvents.filter(event => {
    if (selectedCategory === "all") return true;
    if (selectedCategory === "errors") return event.type === "error";
    return event.category === selectedCategory;
  });
  
  // Event counts for each category
  const eventCounts = {
    all: sseEvents.length,
    http: sseEvents.filter(e => e.category === "http").length,
    sse: sseEvents.filter(e => e.category === "sse").length,
    errors: sseEvents.filter(e => e.type === "error").length
  };
  
  // Format JSON content for display
  const formatJsonContent = (content: string): React.ReactNode => {
    try {
      if (content.startsWith('{') || content.startsWith('[')) {
        const json = JSON.parse(content);
        return (
          <pre className="whitespace-pre-wrap">
            {JSON.stringify(json, null, 2)}
          </pre>
        );
      }
      return content;
    } catch {
      // Parse error, return the raw content
      return content;
    }
  };
  
  // Update a specific connection step
  const markStepCompleted = (stepId: string) => {
    // Check if this step was already processed
    if (processedMessages.current.has(stepId)) return;
    
    // Get the step number from the ID
    const stepNumber = parseInt(stepId.split('-')[1]);
    
    // Validate sequence order - steps must happen in order
    if (stepNumber > 1) {
      // Check if the previous step is completed - check the ref, not the state
      const previousStepId = `step-${stepNumber - 1}`;
      const previousStepCompleted = completedStepsRef.current.has(previousStepId);
      
      if (!previousStepCompleted) {
        // For initialization steps, auto-complete previous steps
        if (stepNumber <= 3) {
          // Mark all steps from 1 to the current one
          for (let i = 1; i < stepNumber; i++) {
            const prevId = `step-${i}`;
            if (!completedStepsRef.current.has(prevId)) {
              completedStepsRef.current.add(prevId);
              processedMessages.current.add(prevId);
              
              // Update the state for UI
              setConnectionSteps(prevState => 
                prevState.map(step => 
                  step.id === prevId 
                    ? { ...step, completed: true, timestamp: new Date().toISOString() } 
                    : step
                )
              );
            }
          }
        } else {
          // For later steps, we want proper sequencing
          return;
        }
      }
    }
    
    // Mark the current step as completed in the ref
    completedStepsRef.current.add(stepId);
    processedMessages.current.add(stepId);
    
    setConnectionSteps(prev => 
      prev.map(step => 
        step.id === stepId 
          ? { ...step, completed: true, timestamp: new Date().toISOString() } 
          : step
      )
    );
  };
  
  // Reset connection steps when connection is lost
  const resetConnectionSteps = () => {
    processedMessages.current.clear();
    completedStepsRef.current.clear();
    setConnectionSteps(prev => 
      prev.map(step => ({ ...step, completed: false, timestamp: null }))
    );
  };
  
  // Initialize the connection steps based on existing state
  const initializeFromExistingState = (client: ClientWithTransport) => {
    try {
      if (!client._transport) return;
      
      const stats = client._transport.getTransportStats?.();
      if (stats) {
        setTransportStats(stats);
        
        // If we have any statistics, we must have done an initialize request
        if (stats.requestCount > 0) {
          markStepCompleted('step-1');
        }
        
        // If we have a session ID, we got a response with capabilities
        if (stats.sessionId) {
          markStepCompleted('step-2');
        }
        
        // If connectionEstablished is true, we sent the initialized notification
        if (stats.connectionEstablished) {
          markStepCompleted('step-3');
        }
        
        // If there are active SSE connections, step 4 is complete
        if (stats.activeSSEConnections > 0) {
          markStepCompleted('step-4');
        }
        
        // If we've received any messages beyond initialization, normal flow has begun
        if (stats.receivedMessages > 1) {
          markStepCompleted('step-5');
        }
      }
      
      // If we detect that all required steps are complete in one batch, mark them all completed 
      if (stats?.connectionEstablished) {
        // Make sure steps 1-3 are marked complete
        ['step-1', 'step-2', 'step-3'].forEach(stepId => {
          if (!completedStepsRef.current.has(stepId)) {
            markStepCompleted(stepId);
          }
        });
      }
      
      // Try to find console logs for protocol stages
      try {
        // Scan for browser resources containing transport logs
        //@ts-expect-error - This is a browser-specific API check
        if (window.performance && window.performance.getEntries) {
          const consoleLogs = performance.getEntries().filter(
            entry => entry.entryType === 'resource' && 
                    entry.name.includes('directTransports.ts')
          );
          
          if (consoleLogs.length > 0) {
            markStepCompleted('step-1'); 
            markStepCompleted('step-2');
            markStepCompleted('step-3');
          }
        }
      } catch {
        // Silently handle API access errors
      }
      
      // Check if active streams exist
      const streams = client._transport.getActiveStreams?.();
      if (streams && streams.length > 0) {
        setActiveStreamCount(streams.length);
        markStepCompleted('step-4');
        markStepCompleted('step-5');
      }
    } catch {
      // Error handling is silent in production
    }
  };
  
  // Poll transport status
  useEffect(() => {
    if (!mcpClient) {
      setHasActiveConnection(false);
      resetConnectionSteps();
      return;
    }
    
    try {
      const client = mcpClient as ClientWithTransport;
      if (!client || !client._transport) {
        setHasActiveConnection(false);
        resetConnectionSteps();
        return;
      }
      
      // Poll for transport status and active streams
      const checkTransport = () => {
        // Get transport stats if available
        if (client._transport?.getTransportStats) {
          const stats = client._transport.getTransportStats();
          setTransportStats(stats);
          setHasActiveConnection(stats.connectionEstablished);
          
          // Update steps based on stats
          if (stats.connectionEstablished && !processedMessages.current.has('step-3')) {
            markStepCompleted('step-1');
            markStepCompleted('step-2');
            markStepCompleted('step-3');
          }
        }
        
        // Check active streams
        if (client._transport?.getActiveStreams) {
          const streams = client._transport.getActiveStreams();
          setActiveStreamCount(streams.length);
          
          if (streams.length > 0) {
            markStepCompleted('step-4');
            markStepCompleted('step-5');
          }
        }
      };
      
      // Do immediate check
      checkTransport();
      
      // Set up interval for checking
      const interval = setInterval(checkTransport, 1000);
      return () => clearInterval(interval);
    } catch {
      // Silent error handling in production
    }
  }, [mcpClient]);
  
  // Subscribe to real transport events
  useEffect(() => {
    if (!mcpClient) {
      setHasActiveConnection(false);
      resetConnectionSteps();
      return;
    }
    
    const addEvent = (
      content: string, 
      type: "message" | "connection" | "error", 
      category: EventCategory,
      streamId?: string, 
      direction: "incoming" | "outgoing" = "incoming"
    ) => {
      const now = new Date();
      setSseEvents(prev => {
        const newEvent: StreamEvent = {
          id: uuidv4(),
          timestamp: now.toISOString(),
          content,
          type,
          streamId,
          direction,
          category
        };
        
        // Keep max 200 events
        const updatedEvents = [...prev, newEvent];
        if (updatedEvents.length > 200) {
          return updatedEvents.slice(-200);
        }
        return updatedEvents;
      });
    };
    
    try {
      const client = mcpClient as ClientWithTransport;
      if (!client || !client._transport) {
        setHasActiveConnection(false);
        resetConnectionSteps();
        return;
      }
      
      setHasActiveConnection(true);
      
      // Initialize from existing state
      initializeFromExistingState(client);
      
      // Check if the transport has a way to register a log callback
      if (client._transport.registerLogCallback && typeof client._transport.registerLogCallback === 'function') {
        client._transport.registerLogCallback((log: TransportLogEntry) => {
          if (!log) return;
          
          // Handle different types of log entries
          if (log.streamId && log.type === 'sseMessage') {
            // This is an SSE message received
            addEvent(
              typeof log.data === 'string' ? log.data : JSON.stringify(log.data), 
              "message", 
              "sse",
              log.streamId
            );
            
            // If we get an SSE message, step 5 is completed
            markStepCompleted('step-5');
          } else if (log.streamId && log.type === 'sseOpen') {
            // New SSE stream opened
            addEvent(
              `SSE Stream opened: ${log.streamId}`, 
              "connection", 
              "sse",
              log.streamId
            );
            
            // Mark step 4 as completed - SSE connection established
            markStepCompleted('step-4');
          } else if (log.streamId && log.type === 'sseClose') {
            // SSE stream closed
            addEvent(
              `SSE Stream closed: ${log.streamId}${log.reason ? ` (${log.reason})` : ''}`, 
              "connection", 
              "sse",
              log.streamId
            );
          } else if (log.type === 'error') {
            // Error event
            addEvent(
              log.message || 'Unknown error', 
              "error", 
              "errors",
              log.streamId
            );
          } else if (log.type === 'request') {
            // Outgoing request
            const requestBody = typeof log.body === 'string' ? log.body : JSON.stringify(log.body);
            addEvent(
              requestBody,
              "message",
              "http",
              log.streamId,
              "outgoing"
            );
            
            // Track connection sequence steps based on request content
            try {
              const requestObj = typeof log.body === 'string' ? JSON.parse(log.body) : log.body;
              if (requestObj) {
                // Check if this is an initialize request
                if ('method' in requestObj && requestObj.method === 'initialize') {
                  markStepCompleted('step-1');
                }
                
                // Check if this is an initialized notification
                if ('method' in requestObj && requestObj.method === 'notifications/initialized') {
                  markStepCompleted('step-3');
                }
                
                // Regular request after initialization
                if ('method' in requestObj && 
                    requestObj.method !== 'initialize' && 
                    requestObj.method !== 'notifications/initialized') {
                  markStepCompleted('step-5');
                }
              }
            } catch {
              // Silent error handling for parsing
            }
          } else if (log.type === 'response' && !log.isSSE) {
            // Regular HTTP response (not SSE)
            const responseBody = typeof log.body === 'string' ? log.body : JSON.stringify(log.body);
            addEvent(
              responseBody,
              "message",
              "http",
              log.streamId,
              "incoming"
            );
            
            // Track connection sequence based on response content
            try {
              // Check if this is an initialize response with session ID
              if (typeof responseBody === 'string' && 
                  responseBody.includes('"protocolVersion"') && 
                  responseBody.includes('"capabilities"')) {
                markStepCompleted('step-2');
              }
            } catch {
              // Silent error handling for parsing
            }
          }
        });
      }
    } catch {
      // Silent error handling in production
      setHasActiveConnection(false);
      resetConnectionSteps();
    }
  }, [mcpClient]);
  
  // Auto-scroll to bottom when new events come in
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [filteredEvents]); // Now using filteredEvents to avoid scrolling when just changing tabs

  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return "";
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString();
    } catch {
      // Silently handle any parsing errors
      return "";
    }
  };

  // Display connection status and stats
  const getConnectionStatusSummary = () => {
    if (!transportStats) return "No connection data available";
    
    const summary = [
      `Session ID: ${transportStats.sessionId || "None"}`,
      `Connection established: ${transportStats.connectionEstablished ? "Yes" : "No"}`,
      `Active SSE streams: ${transportStats.activeSSEConnections}`,
      `Total requests: ${transportStats.requestCount}`,
      `Total responses: ${transportStats.responseCount}`
    ];
    
    return summary.join(' • ');
  };

  return (
    <TabsContent value="stats" className="w-full">
      <div className="p-4 bg-card rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4">MCP Transport Inspector</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column - Connection Stats and Sequence */}
          <div className="space-y-6">
            {/* Connection Statistics */}
            <div>
              <h3 className="text-md font-semibold mb-2">Connection Statistics</h3>
              <div className="bg-background p-4 rounded-md shadow-sm border text-base">
                <StreamableHttpStats mcpClient={mcpClient} />
                
                {transportStats && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    <p>{getConnectionStatusSummary()}</p>
                  </div>
                )}
              </div>
            </div>
            
            {/* Connection Sequence */}
            <div>
              <h3 className="text-md font-semibold mb-2">Connection Sequence</h3>
              <div className="p-4 border rounded-md bg-muted/50">
                <p className="text-sm text-muted-foreground mb-4">
                  The Streamable HTTP transport follows this initialization sequence per spec:
                </p>
                <ol className="text-sm space-y-2 list-none">
                  {connectionSteps.map((step) => (
                    <li key={step.id} className="flex items-start">
                      <span className={`mr-2 font-bold ${step.completed ? "text-green-500" : "text-gray-400"}`}>
                        {step.completed ? "✅" : "○"}
                      </span>
                      <span className="mr-2">{step.id.split('-')[1]}.</span>
                      <div className="flex flex-col">
                        <span>{step.description}</span>
                        {step.timestamp && (
                          <span className="text-xs text-muted-foreground">
                            Completed at: {formatTimestamp(step.timestamp)}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
          
          {/* Right Column - Network Traffic */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-md font-semibold">
                Network Traffic
                {activeStreamCount > 0 && (
                  <span className="ml-2 text-xs font-normal text-green-500">
                    ({activeStreamCount} active stream{activeStreamCount !== 1 ? 's' : ''})
                  </span>
                )}
              </h3>
            </div>
            
            <Tabs 
              defaultValue="all" 
              className="w-full" 
              onValueChange={(value) => setSelectedCategory(value as EventCategory)}
            >
              <TabsList className="mb-2">
                <TabsTrigger value="all">
                  All Events
                  {eventCounts.all > 0 && <span className="ml-2 px-1.5 py-0.5 rounded-full bg-gray-600 text-white text-xs">{eventCounts.all}</span>}
                </TabsTrigger>
                <TabsTrigger value="http">
                  HTTP Requests
                  {eventCounts.http > 0 && <span className="ml-2 px-1.5 py-0.5 rounded-full bg-gray-600 text-white text-xs">{eventCounts.http}</span>}
                </TabsTrigger>
                <TabsTrigger value="sse">
                  SSE Events
                  {eventCounts.sse > 0 && <span className="ml-2 px-1.5 py-0.5 rounded-full bg-gray-600 text-white text-xs">{eventCounts.sse}</span>}
                </TabsTrigger>
                <TabsTrigger value="errors">
                  Errors
                  {eventCounts.errors > 0 && <span className="ml-2 px-1.5 py-0.5 rounded-full bg-red-600 text-white text-xs">{eventCounts.errors}</span>}
                </TabsTrigger>
              </TabsList>

              <div className="relative">
                <div 
                  ref={logContainerRef}
                  className="bg-black text-green-400 font-mono text-xs p-3 rounded h-[calc(100vh-16rem)] overflow-y-auto"
                >
                  {filteredEvents.length > 0 ? (
                    filteredEvents.map(event => (
                      <div 
                        key={event.id} 
                        className={`py-1 ${
                          event.type === "error" 
                            ? "text-red-400" 
                            : event.type === "connection" 
                              ? "text-blue-400" 
                              : event.direction === "outgoing"
                                ? "text-yellow-400"
                                : "text-green-400"
                        }`}
                      >
                        <span className="text-gray-500">[{event.timestamp.split('T')[1].split('.')[0]}]</span>{' '}
                        
                        {/* Category indicator */}
                        <span className={`px-1 text-xs rounded ${
                          event.category === "http" 
                            ? "bg-purple-900 text-purple-200" 
                            : event.category === "sse" 
                              ? "bg-blue-900 text-blue-200"
                              : "bg-red-900 text-red-200"
                        }`}>
                          {event.category === "http" ? "HTTP" : event.category === "sse" ? "SSE" : "ERR"}
                        </span>{' '}
                        
                        {event.streamId && (
                          <span className="text-purple-400 px-1">[{event.streamId.substring(0, 6)}]</span>
                        )}
                        {event.direction === "outgoing" && (
                          <span className="text-yellow-400 px-1">▶</span>
                        )}
                        {event.direction === "incoming" && (
                          <span className="text-green-400 px-1">◀</span>
                        )}
                        {formatJsonContent(event.content)}
                      </div>
                    ))
                  ) : hasActiveConnection ? (
                    <div className="py-1 text-gray-500">
                      {selectedCategory === "all" 
                        ? "No events received yet. Waiting for activity..." 
                        : selectedCategory === "http" 
                          ? "No HTTP requests/responses captured yet." 
                          : selectedCategory === "sse" 
                            ? "No SSE events captured yet. SSE connections will appear here." 
                            : "No errors recorded yet."}
                    </div>
                  ) : (
                    <div className="py-1 text-gray-500">No active connection. Connect to an MCP server to see events.</div>
                  )}
                </div>
                <div className="absolute right-2 bottom-2">
                  <div className="flex items-center">
                    <span className={`inline-block w-2 h-2 rounded-full mr-1 ${activeStreamCount > 0 ? "bg-green-500 animate-pulse" : "bg-gray-500"}`}></span>
                    <span className="text-xs text-gray-400">{activeStreamCount > 0 ? 'Live' : 'Inactive'}</span>
                  </div>
                </div>
              </div>
            </Tabs>
          </div>
        </div>
      </div>
    </TabsContent>
  );
};

export default StatsTab; 
