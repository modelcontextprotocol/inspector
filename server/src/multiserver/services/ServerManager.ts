// Core business logic for server management
import type {
  MultiServerConfig,
  CreateServerRequest,
  UpdateServerRequest,
  ValidationResult,
  StdioServerConfig,
  HttpServerConfig,
} from "../models/types.js";
import {
  CreateServerRequestSchema,
  UpdateServerRequestSchema,
  isStdioServerConfig,
  isHttpServerConfig,
} from "../models/types.js";
import { generateServerId } from "../utils/idGenerator.js";
import type { ConnectionManager } from "./ConnectionManager.js";

/**
 * Manages server configurations and their lifecycle
 */
export class ServerManager {
  private servers: Map<string, MultiServerConfig> = new Map();
  private connectionManager: ConnectionManager;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  /**
   * Creates a new server configuration
   */
  async createServer(request: CreateServerRequest): Promise<MultiServerConfig> {
    // Validate the request
    const validation = this.validateServerConfig(request);
    if (!validation.isValid) {
      throw new Error(
        `Invalid server configuration: ${validation.errors?.join(", ")}`,
      );
    }

    // Generate unique server ID
    const serverId = this.generateServerId();
    const now = new Date();

    // Create server configuration based on transport type
    let serverConfig: MultiServerConfig;

    if (request.transportType === "stdio") {
      serverConfig = {
        id: serverId,
        name: request.name,
        description: request.description,
        transportType: "stdio",
        config: {
          command: (request.config as any).command,
          args: (request.config as any).args || [],
          env: (request.config as any).env || {},
        },
        createdAt: now,
        updatedAt: now,
      } as StdioServerConfig;
    } else if (request.transportType === "streamable-http") {
      serverConfig = {
        id: serverId,
        name: request.name,
        description: request.description,
        transportType: "streamable-http",
        config: {
          url: (request.config as any).url,
          headers: (request.config as any).headers,
          bearerToken: (request.config as any).bearerToken,
          headerName: (request.config as any).headerName,
          oauthClientId: (request.config as any).oauthClientId,
          oauthScope: (request.config as any).oauthScope,
        },
        createdAt: now,
        updatedAt: now,
      } as HttpServerConfig;
    } else {
      throw new Error(`Unsupported transport type: ${request.transportType}`);
    }

    // Store the server configuration
    this.servers.set(serverId, serverConfig);

    return serverConfig;
  }

  /**
   * Retrieves a server configuration by ID
   */
  async getServer(id: string): Promise<MultiServerConfig | null> {
    return this.servers.get(id) || null;
  }

  /**
   * Retrieves all server configurations
   */
  async getAllServers(): Promise<MultiServerConfig[]> {
    return Array.from(this.servers.values());
  }

  /**
   * Updates an existing server configuration
   */
  async updateServer(
    id: string,
    updates: UpdateServerRequest,
  ): Promise<MultiServerConfig> {
    const existingServer = this.servers.get(id);
    if (!existingServer) {
      throw new Error(`Server with ID ${id} not found`);
    }

    // Validate the update request
    const validation = this.validateUpdateRequest(updates);
    if (!validation.isValid) {
      throw new Error(
        `Invalid update request: ${validation.errors?.join(", ")}`,
      );
    }

    // Create updated server configuration
    let updatedServer: MultiServerConfig;

    // If config is being updated, merge it properly
    if (updates.config) {
      if (isStdioServerConfig(existingServer)) {
        const configUpdate = updates.config as any;
        updatedServer = {
          ...existingServer,
          ...updates,
          id, // Ensure ID cannot be changed
          updatedAt: new Date(),
          config: {
            command: configUpdate.command || existingServer.config.command,
            args: configUpdate.args || existingServer.config.args,
            env: { ...existingServer.config.env, ...configUpdate.env },
          },
        } as StdioServerConfig;
      } else if (isHttpServerConfig(existingServer)) {
        const configUpdate = updates.config as any;
        updatedServer = {
          ...existingServer,
          ...updates,
          id, // Ensure ID cannot be changed
          updatedAt: new Date(),
          config: {
            url: configUpdate.url || existingServer.config.url,
            headers: {
              ...existingServer.config.headers,
              ...configUpdate.headers,
            },
            bearerToken:
              configUpdate.bearerToken || existingServer.config.bearerToken,
            headerName:
              configUpdate.headerName || existingServer.config.headerName,
            oauthClientId:
              configUpdate.oauthClientId || existingServer.config.oauthClientId,
            oauthScope:
              configUpdate.oauthScope || existingServer.config.oauthScope,
          },
        } as HttpServerConfig;
      } else {
        throw new Error(`Unsupported server type for update`);
      }
    } else {
      // No config update, just update other properties
      updatedServer = {
        ...existingServer,
        ...updates,
        id, // Ensure ID cannot be changed
        updatedAt: new Date(),
      } as MultiServerConfig;
    }

    // Store the updated configuration
    this.servers.set(id, updatedServer);

    return updatedServer;
  }

  /**
   * Deletes a server configuration and cleans up connections
   */
  async deleteServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) {
      throw new Error(`Server with ID ${id} not found`);
    }

    // Disconnect from server if connected
    if (await this.connectionManager.isServerConnected(id)) {
      await this.connectionManager.disconnectFromServer(id);
    }

    // Remove server configuration
    this.servers.delete(id);
  }

  /**
   * Validates server configuration request
   */
  validateServerConfig(config: CreateServerRequest): ValidationResult {
    try {
      CreateServerRequestSchema.parse(config);
      return { isValid: true };
    } catch (error: any) {
      const errors = error.errors?.map(
        (e: any) => `${e.path.join(".")}: ${e.message}`,
      ) || [error.message];
      return { isValid: false, errors };
    }
  }

  /**
   * Validates server update request
   */
  private validateUpdateRequest(
    updates: UpdateServerRequest,
  ): ValidationResult {
    try {
      UpdateServerRequestSchema.parse(updates);
      return { isValid: true };
    } catch (error: any) {
      const errors = error.errors?.map(
        (e: any) => `${e.path.join(".")}: ${e.message}`,
      ) || [error.message];
      return { isValid: false, errors };
    }
  }

  /**
   * Generates a unique server ID
   */
  private generateServerId(): string {
    let id: string;
    do {
      id = generateServerId();
    } while (this.servers.has(id)); // Ensure uniqueness
    return id;
  }

  /**
   * Gets the number of configured servers
   */
  getServerCount(): number {
    return this.servers.size;
  }

  /**
   * Checks if a server exists
   */
  hasServer(id: string): boolean {
    return this.servers.has(id);
  }
}
