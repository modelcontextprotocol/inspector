// Transport creation utility
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { findActualExecutable } from "spawn-rx";
import type {
  MultiServerConfig,
  StdioServerConfig,
  HttpServerConfig,
} from "../models/types.js";

/**
 * Factory class for creating transport instances based on server configuration
 */
export class TransportFactory {
  /**
   * Creates appropriate transport based on server configuration
   */
  async createTransportForServer(
    config: MultiServerConfig,
  ): Promise<Transport> {
    try {
      if (config.transportType === "stdio") {
        return await this.createStdioTransport(config as StdioServerConfig);
      } else if (config.transportType === "streamable-http") {
        return await this.createHttpTransport(config as HttpServerConfig);
      } else {
        throw new Error(
          `Unsupported transport type: ${(config as any).transportType}`,
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to create transport for server ${config.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Creates STDIO transport for command-based servers
   */
  private async createStdioTransport(
    config: StdioServerConfig,
  ): Promise<StdioClientTransport> {
    const processEnv: Record<string, string> = {};

    // Copy current process environment
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        processEnv[key] = value;
      }
    }

    // Get default MCP environment
    const defaultEnv = this.getDefaultEnvironment();

    // Merge environments: process env + default env + server-specific env
    const env: Record<string, string> = {
      ...processEnv,
      ...defaultEnv,
      ...config.config.env,
    };

    // Find actual executable and resolve arguments
    const { cmd: actualCommand, args: actualArgs } = findActualExecutable(
      config.config.command,
      config.config.args,
    );

    return new StdioClientTransport({
      command: actualCommand,
      args: actualArgs,
      env,
      stderr: "pipe",
    });
  }

  /**
   * Creates HTTP transport for URL-based servers
   */
  private async createHttpTransport(
    config: HttpServerConfig,
  ): Promise<StreamableHTTPClientTransport> {
    const url = new URL(config.config.url);

    // Create transport with URL
    const transport = new StreamableHTTPClientTransport(url);

    // Note: Additional HTTP configuration like headers, auth tokens, etc.
    // would be handled by the StreamableHTTPClientTransport constructor
    // or through its configuration options if supported by the SDK

    return transport;
  }

  /**
   * Gets default environment variables for MCP
   */
  private getDefaultEnvironment(): Record<string, string> {
    return getDefaultEnvironment();
  }
}

/**
 * Default transport factory instance
 */
export const defaultTransportFactory = new TransportFactory();
