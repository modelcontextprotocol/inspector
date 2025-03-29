export type ConfigItem = {
  description: string;
  value: string | number | boolean;
};

/**
 * Configuration interface for the MCP Inspector, including settings for the MCP Client,
 * Proxy Server, and Inspector UI/UX.
 *
 * Note: Configuration related to which MCP Server to use or any other MCP Server
 * specific settings are outside the scope of this interface as of now.
 */
export type InspectorConfig = {
  /**
   * Maximum time in milliseconds to wait for a response from the MCP server before timing out.
   */
  MCP_SERVER_REQUEST_TIMEOUT: ConfigItem;
};
