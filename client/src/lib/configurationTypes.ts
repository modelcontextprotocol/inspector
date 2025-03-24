export type ConfigItem = {
  description: string;
  value: string | number | boolean;
}

export type InspectorConfig = {
  MCP_SERVER_REQUEST_TIMEOUT: ConfigItem;
};