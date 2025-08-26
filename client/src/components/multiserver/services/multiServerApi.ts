import {
  CreateServerRequest,
  UpdateServerRequest,
  ServerResponse,
  ServerListResponse,
  ConnectionRequest,
  ConnectionResponse,
  ServerStatus,
} from "../types/multiserver.js";
import { validateServerConfig } from "../../../utils/serverConfigValidation";
import { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { globalRequestDeduplicator } from "../utils/requestDeduplicator.js";

// Get the API base URL from the same configuration as single-server mode
async function getApiBaseUrl(): Promise<string> {
  try {
    const { getMCPProxyAddress, initializeInspectorConfig } = await import(
      "../../../utils/configUtils"
    );
    const config = initializeInspectorConfig("inspectorConfig_v1");
    const proxyAddress = getMCPProxyAddress(config);
    return `${proxyAddress}/api`;
  } catch (error) {
    console.error("Failed to get API base URL:", error);
    // Fallback to relative URL
    return "/api";
  }
}

// Get authentication token from configuration (same as single-server mode)
async function getAuthToken(): Promise<string | null> {
  try {
    // Import config utilities dynamically to avoid circular dependencies
    const { initializeInspectorConfig, getMCPProxyAuthToken } = await import(
      "../../../utils/configUtils"
    );

    // Get the inspector config from localStorage (same as single-server mode)
    const config = initializeInspectorConfig("inspectorConfig_v1");

    // Get the proxy auth token using the same method as single-server mode
    const { token } = getMCPProxyAuthToken(config);

    return token || null;
  } catch (error) {
    console.error("Failed to get auth token:", error);

    // Fallback: Check URL parameters (for when token is passed via URL)
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get("MCP_PROXY_AUTH_TOKEN");

    return tokenFromUrl || null;
  }
}

// Create a cache key for deduplication
function createCacheKey(method: string, url: string, body?: string): string {
  return `${method}:${url}:${body || ""}`;
}

// Enhanced deduplicated fetch function using the global request deduplicator
async function deduplicatedFetch<T>(
  url: string,
  options: RequestInit,
  cacheDuration: number = 2000, // Cache for 2 seconds by default
): Promise<T> {
  const cacheKey = createCacheKey(
    options.method || "GET",
    url,
    options.body as string,
  );

  const result = await globalRequestDeduplicator.deduplicateRequest(
    cacheKey,
    () => fetch(url, options).then(handleApiResponse<T>),
    cacheDuration,
  );

  return result.data;
}

// Get default headers with authentication
async function getDefaultHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  const token = await getAuthToken();
  if (token) {
    headers["X-MCP-Proxy-Auth"] = `Bearer ${token}`;
  }

  return headers;
}

class MultiServerApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status?: number,
    public details?: any,
  ) {
    super(message);
    this.name = "MultiServerApiError";
  }
}

async function handleApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData: any;
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: response.statusText };
    }

    throw new MultiServerApiError(
      errorData.message || "API request failed",
      errorData.code || "UNKNOWN_ERROR",
      response.status,
      errorData,
    );
  }

  return response.json();
}

export class MultiServerApi {
  // Server management
  static async createServer(
    config: CreateServerRequest,
  ): Promise<ServerResponse> {
    const apiBaseUrl = await getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/servers`, {
      method: "POST",
      headers: await getDefaultHeaders(),
      body: JSON.stringify(config),
    });

    return handleApiResponse<ServerResponse>(response);
  }

  static async getServers(): Promise<ServerListResponse> {
    const apiBaseUrl = await getApiBaseUrl();
    const data = await deduplicatedFetch<ServerListResponse>(
      `${apiBaseUrl}/servers`,
      {
        headers: await getDefaultHeaders(),
      },
    );

    // Validate and sanitize server configs
    const validatedServers = data.servers
      .map((serverResponse) => {
        const validatedServer = validateServerConfig(serverResponse.server);
        return {
          ...serverResponse,
          server: validatedServer || serverResponse.server, // Keep original if validation fails
        };
      })
      .filter((serverResponse) => serverResponse.server !== null);

    return {
      servers: validatedServers,
    };
  }

  static async getServer(id: string): Promise<ServerResponse> {
    const apiBaseUrl = await getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/servers/${id}`, {
      headers: await getDefaultHeaders(),
    });
    return handleApiResponse<ServerResponse>(response);
  }

  static async updateServer(
    id: string,
    config: UpdateServerRequest,
  ): Promise<ServerResponse> {
    const apiBaseUrl = await getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/servers/${id}`, {
      method: "PUT",
      headers: await getDefaultHeaders(),
      body: JSON.stringify(config),
    });

    return handleApiResponse<ServerResponse>(response);
  }

  static async deleteServer(id: string): Promise<void> {
    const apiBaseUrl = await getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/servers/${id}`, {
      method: "DELETE",
      headers: await getDefaultHeaders(),
    });

    if (!response.ok) {
      await handleApiResponse(response);
    }
  }

  // Connection management
  static async connectServer(serverId: string): Promise<ConnectionResponse> {
    const apiBaseUrl = await getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/connections`, {
      method: "POST",
      headers: await getDefaultHeaders(),
      body: JSON.stringify({ serverId } as ConnectionRequest),
    });

    return handleApiResponse<ConnectionResponse>(response);
  }

  static async disconnectServer(serverId: string): Promise<void> {
    const apiBaseUrl = await getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/connections/${serverId}`, {
      method: "DELETE",
      headers: await getDefaultHeaders(),
    });

    if (!response.ok) {
      await handleApiResponse(response);
    }
  }

  static async getConnections(): Promise<ConnectionResponse[]> {
    const apiBaseUrl = await getApiBaseUrl();
    return deduplicatedFetch<ConnectionResponse[]>(
      `${apiBaseUrl}/connections`,
      {
        headers: await getDefaultHeaders(),
      },
    );
  }

  static async getConnection(serverId: string): Promise<ConnectionResponse> {
    const apiBaseUrl = await getApiBaseUrl();
    return deduplicatedFetch<ConnectionResponse>(
      `${apiBaseUrl}/connections/${serverId}`,
      {
        headers: await getDefaultHeaders(),
      },
    );
  }

  // Server status
  static async getServerStatus(serverId: string): Promise<ServerStatus> {
    const apiBaseUrl = await getApiBaseUrl();
    return deduplicatedFetch<ServerStatus>(
      `${apiBaseUrl}/servers/${serverId}/status`,
      {
        headers: await getDefaultHeaders(),
      },
    );
  }

  // Utility methods
  static async testConnection(
    config: CreateServerRequest,
  ): Promise<{ success: boolean; error?: string }> {
    const apiBaseUrl = await getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/servers/test`, {
      method: "POST",
      headers: await getDefaultHeaders(),
      body: JSON.stringify(config),
    });

    return handleApiResponse<{ success: boolean; error?: string }>(response);
  }

  static async getDefaultConfig(): Promise<{
    defaultEnvironment?: Record<string, string>;
    defaultCommand?: string;
    defaultArgs?: string;
    defaultTransport?: string;
    defaultServerUrl?: string;
  }> {
    // Import the config utilities to get the MCP proxy address
    const { getMCPProxyAddress, getMCPProxyAuthToken } = await import(
      "../../../utils/configUtils"
    );
    const { initializeInspectorConfig } = await import(
      "../../../utils/configUtils"
    );

    // Get the inspector config from localStorage (same as single-server mode)
    const config = initializeInspectorConfig("inspectorConfig_v1");

    // Build headers with proxy authentication
    const headers: HeadersInit = {};
    const { token: proxyAuthToken, header: proxyAuthTokenHeader } =
      getMCPProxyAuthToken(config);
    if (proxyAuthToken) {
      headers[proxyAuthTokenHeader] = `Bearer ${proxyAuthToken}`;
    }

    // Use deduplication for config requests to prevent duplicate calls
    return deduplicatedFetch(
      `${getMCPProxyAddress(config)}/config`,
      {
        headers,
      },
      2000,
    ); // Cache for 2 seconds since config doesn't change frequently
  }

  // Logging level management
  static async setServerLogLevel(
    serverId: string,
    level: LoggingLevel,
  ): Promise<void> {
    const apiBaseUrl = await getApiBaseUrl();
    const url = `${apiBaseUrl}/connections/${serverId}/logging`;

    console.log(
      `[MultiServerApi] Setting log level for server ${serverId} to ${level}`,
    );
    console.log(`[MultiServerApi] Making POST request to: ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers: await getDefaultHeaders(),
      body: JSON.stringify({ level }),
    });

    console.log(`[MultiServerApi] Response status: ${response.status}`);

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`[MultiServerApi] setServerLogLevel failed:`, errorData);
      await handleApiResponse(response);
    } else {
      console.log(
        `[MultiServerApi] Successfully set log level for server ${serverId} to ${level}`,
      );
    }
  }

  // MCP Operations - Resources
  static async listResources(serverId: string, cursor?: string): Promise<any> {
    const apiBaseUrl = await getApiBaseUrl();
    return deduplicatedFetch(
      `${apiBaseUrl}/mcp/${serverId}/resources${cursor ? `?cursor=${cursor}` : ""}`,
      {
        headers: await getDefaultHeaders(),
      },
    );
  }

  static async readResource(serverId: string, uri: string): Promise<any> {
    const apiBaseUrl = await getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/mcp/${serverId}/request`, {
      method: "POST",
      headers: await getDefaultHeaders(),
      body: JSON.stringify({
        method: "resources/read",
        params: { uri },
      }),
    });
    return handleApiResponse(response);
  }

  static async subscribeToResource(
    serverId: string,
    uri: string,
  ): Promise<any> {
    const apiBaseUrl = await getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/mcp/${serverId}/request`, {
      method: "POST",
      headers: await getDefaultHeaders(),
      body: JSON.stringify({
        method: "resources/subscribe",
        params: { uri },
      }),
    });
    return handleApiResponse(response);
  }

  static async unsubscribeFromResource(
    serverId: string,
    uri: string,
  ): Promise<any> {
    const apiBaseUrl = await getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/mcp/${serverId}/request`, {
      method: "POST",
      headers: await getDefaultHeaders(),
      body: JSON.stringify({
        method: "resources/unsubscribe",
        params: { uri },
      }),
    });
    return handleApiResponse(response);
  }

  static async listResourceTemplates(
    serverId: string,
    cursor?: string,
  ): Promise<any> {
    const apiBaseUrl = await getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/mcp/${serverId}/request`, {
      method: "POST",
      headers: await getDefaultHeaders(),
      body: JSON.stringify({
        method: "resources/templates/list",
        params: cursor ? { cursor } : {},
      }),
    });
    return handleApiResponse(response);
  }

  // MCP Operations - Tools
  static async listTools(serverId: string, cursor?: string): Promise<any> {
    const apiBaseUrl = await getApiBaseUrl();
    return deduplicatedFetch(
      `${apiBaseUrl}/mcp/${serverId}/tools${cursor ? `?cursor=${cursor}` : ""}`,
      {
        headers: await getDefaultHeaders(),
      },
    );
  }

  static async callTool(
    serverId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<any> {
    const apiBaseUrl = await getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/mcp/${serverId}/request`, {
      method: "POST",
      headers: await getDefaultHeaders(),
      body: JSON.stringify({
        method: "tools/call",
        params: {
          name,
          arguments: args,
          _meta: {
            progressToken: Date.now(),
          },
        },
      }),
    });
    return handleApiResponse(response);
  }

  // MCP Operations - Prompts
  static async listPrompts(serverId: string, cursor?: string): Promise<any> {
    const apiBaseUrl = await getApiBaseUrl();
    return deduplicatedFetch(
      `${apiBaseUrl}/mcp/${serverId}/prompts${cursor ? `?cursor=${cursor}` : ""}`,
      {
        headers: await getDefaultHeaders(),
      },
    );
  }

  static async getPrompt(
    serverId: string,
    name: string,
    args: Record<string, string> = {},
  ): Promise<any> {
    const apiBaseUrl = await getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/mcp/${serverId}/request`, {
      method: "POST",
      headers: await getDefaultHeaders(),
      body: JSON.stringify({
        method: "prompts/get",
        params: { name, arguments: args },
      }),
    });
    return handleApiResponse(response);
  }

  // MCP Operations - General
  static async sendPing(serverId: string): Promise<any> {
    const apiBaseUrl = await getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/mcp/${serverId}/request`, {
      method: "POST",
      headers: await getDefaultHeaders(),
      body: JSON.stringify({
        method: "ping",
      }),
    });
    return handleApiResponse(response);
  }

  static async getCapabilities(serverId: string): Promise<any> {
    const apiBaseUrl = await getApiBaseUrl();
    return deduplicatedFetch(`${apiBaseUrl}/mcp/${serverId}/capabilities`, {
      headers: await getDefaultHeaders(),
    });
  }

  // WebSocket connection for real-time updates
  static async createEventStream(
    onEvent: (event: MessageEvent) => void,
    onError?: (error: Event) => void,
  ): Promise<EventSource> {
    // EventSource doesn't support custom headers directly, so we need to pass auth via URL params
    const token = await getAuthToken();
    const apiBaseUrl = await getApiBaseUrl();
    let eventUrl = `${apiBaseUrl}/events`;

    // If we have a token, add it as a query parameter since EventSource doesn't support custom headers
    if (token) {
      const urlParams = new URLSearchParams();
      urlParams.set("MCP_PROXY_AUTH_TOKEN", token);
      eventUrl += `?${urlParams.toString()}`;
    }

    const eventSource = new EventSource(eventUrl);

    eventSource.onmessage = onEvent;

    if (onError) {
      eventSource.onerror = onError;
    }

    return eventSource;
  }
}

export { MultiServerApiError };
