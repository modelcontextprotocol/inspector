import type { ServerConfig } from "./test-server-fixtures.js";
export interface RecordedRequest {
    method: string;
    params?: any;
    headers?: Record<string, string>;
    metadata?: Record<string, string>;
    response: any;
    timestamp: number;
}
export declare class TestServerHttp {
    private config;
    private readonly configWithCallback;
    private readonly serverControl;
    private _closing;
    private recordedRequests;
    private httpServer?;
    private transport?;
    private baseUrl?;
    private currentRequestHeaders?;
    private currentLogLevel;
    /** One McpServer per connection (SSE and streamable-http both use this; SDK allows only one transport per server) */
    private mcpServersBySession?;
    constructor(config: ServerConfig);
    /**
     * Set up message interception for a transport to record incoming messages
     * This wraps the transport's onmessage handler to record requests/notifications
     */
    private setupMessageInterception;
    /**
     * Start the server using the configuration from ServerConfig
     */
    start(): Promise<number>;
    private startHttp;
    private startSse;
    /**
     * Stop the server. Set closing before closing transport so in-flight tools can skip sending.
     */
    stop(): Promise<void>;
    /**
     * Get all recorded requests
     */
    getRecordedRequests(): RecordedRequest[];
    /**
     * Clear recorded requests
     */
    clearRecordings(): void;
    /**
     * Wait until a recorded request matches the predicate, or reject after timeout.
     * Use instead of polling getRecordedRequests() with manual delays.
     */
    waitUntilRecorded(predicate: (req: RecordedRequest) => boolean, options?: {
        timeout?: number;
        interval?: number;
    }): Promise<RecordedRequest>;
    /**
     * Get the server URL with the appropriate endpoint path
     */
    get url(): string;
    /**
     * Get the most recent log level that was set
     */
    getCurrentLogLevel(): string | null;
}
/**
 * Create an HTTP/SSE MCP test server
 */
export declare function createTestServerHttp(config: ServerConfig): TestServerHttp;
//# sourceMappingURL=test-server-http.d.ts.map