#!/usr/bin/env node
/**
 * Test MCP server for stdio transport testing
 * Can be used programmatically or run as a standalone executable
 */
import type { ServerConfig } from "./test-server-fixtures.js";
export declare class TestServerStdio {
    private mcpServer;
    private config;
    private transport?;
    constructor(config: ServerConfig);
    /**
     * Start the server with stdio transport
     */
    start(): Promise<void>;
    /**
     * Stop the server
     */
    stop(): Promise<void>;
}
/**
 * Create a stdio MCP test server
 */
export declare function createTestServerStdio(config: ServerConfig): TestServerStdio;
/**
 * Get the path to the test MCP server script.
 * Uses the actual loaded module path so it works when loaded from source (.ts) or build (.js).
 */
export declare function getTestMcpServerPath(): string;
/**
 * Get the command and args to run the test MCP server
 */
export declare function getTestMcpServerCommand(): {
    command: string;
    args: string[];
};
//# sourceMappingURL=test-server-stdio.d.ts.map