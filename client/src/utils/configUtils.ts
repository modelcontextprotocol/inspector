import { InspectorConfig } from "@/lib/configurationTypes";

export const getMCPServerRequestTimeout = (config: InspectorConfig): number => {
  return config.MCP_SERVER_REQUEST_TIMEOUT.value as number;
};
