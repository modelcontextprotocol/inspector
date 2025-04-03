import { InspectorConfig } from "@/lib/configurationTypes";
import { DEFAULT_MCP_PROXY_LISTEN_PORT } from "@/lib/constants";

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: {
      MCP_PROXY_FULL_ADDRESS?: string;
      MCP_PROXY_PORT?: string;
    };
  }
}

export const getMCPProxyAddress = (config: InspectorConfig): string => {
  // First check for runtime injected MCP_PROXY_FULL_ADDRESS
  if (window.__RUNTIME_CONFIG__?.MCP_PROXY_FULL_ADDRESS) {
    return window.__RUNTIME_CONFIG__.MCP_PROXY_FULL_ADDRESS;
  }

  // Then check for config from local storage
  const proxyFullAddress = config.MCP_PROXY_FULL_ADDRESS.value as string;
  if (proxyFullAddress) {
    return proxyFullAddress;
  }

  // Finally use the runtime port if available, otherwise default port
  const proxyPort =
    window.__RUNTIME_CONFIG__?.MCP_PROXY_PORT || DEFAULT_MCP_PROXY_LISTEN_PORT;
  return `http://${window.location.hostname}:${proxyPort}`;
};

export const getMCPServerRequestTimeout = (config: InspectorConfig): number => {
  return config.MCP_SERVER_REQUEST_TIMEOUT.value as number;
};
