import { InspectorConfig } from "@/lib/configurationTypes";
import {
  DEFAULT_MCP_PROXY_LISTEN_PORT,
  DEFAULT_INSPECTOR_CONFIG,
} from "@/lib/constants";

export const getMCPProxyAddress = (config: InspectorConfig): string => {
  const proxyFullAddress = config.MCP_PROXY_FULL_ADDRESS.value as string;
  if (proxyFullAddress) {
    return proxyFullAddress;
  }
  return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_MCP_PROXY_LISTEN_PORT}`;
};

export const getMCPServerRequestTimeout = (config: InspectorConfig): number => {
  return config.MCP_SERVER_REQUEST_TIMEOUT.value as number;
};

export const resetRequestTimeoutOnProgress = (
  config: InspectorConfig,
): boolean => {
  return config.MCP_REQUEST_TIMEOUT_RESET_ON_PROGRESS.value as boolean;
};

export const getMCPServerRequestMaxTotalTimeout = (
  config: InspectorConfig,
): number => {
  return config.MCP_REQUEST_MAX_TOTAL_TIMEOUT.value as number;
};

const getSearchParam = (key: string): string | null => {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(key);
  } catch {
    return null;
  }
};

export const getInitialTransportType = ():
  | "stdio"
  | "sse"
  | "streamable-http" => {
  const param = getSearchParam("transport");
  if (param === "stdio" || param === "sse" || param === "streamable-http") {
    return param;
  }
  return (
    (localStorage.getItem("lastTransportType") as
      | "stdio"
      | "sse"
      | "streamable-http") || "stdio"
  );
};

export const getInitialSseUrl = (): string => {
  const param = getSearchParam("serverUrl");
  if (param) return param;
  return localStorage.getItem("lastSseUrl") || "http://localhost:3001/sse";
};

export const getInitialCommand = (): string => {
  const param = getSearchParam("serverCommand");
  if (param) return param;
  return localStorage.getItem("lastCommand") || "mcp-server-everything";
};

export const getInitialArgs = (): string => {
  const param = getSearchParam("serverArgs");
  if (param) return param;
  return localStorage.getItem("lastArgs") || "";
};

// Returns a map of config key -> value from query params if present
export const getConfigOverridesFromQueryParams = (
  defaultConfig: InspectorConfig,
): Partial<InspectorConfig> => {
  const url = new URL(window.location.href);
  const overrides: Partial<InspectorConfig> = {};
  for (const key of Object.keys(defaultConfig)) {
    const param = url.searchParams.get(key);
    if (param !== null) {
      // Try to coerce to correct type based on default value
      const defaultValue = defaultConfig[key as keyof InspectorConfig].value;
      let value: string | number | boolean = param;
      if (typeof defaultValue === "number") {
        value = Number(param);
      } else if (typeof defaultValue === "boolean") {
        value = param === "true";
      }
      overrides[key as keyof InspectorConfig] = {
        ...defaultConfig[key as keyof InspectorConfig],
        value,
      };
    }
  }
  return overrides;
};

export const initializeInspectorConfig = (
  localStorageKey: string,
): InspectorConfig => {
  const savedConfig = localStorage.getItem(localStorageKey);
  let baseConfig: InspectorConfig;
  if (savedConfig) {
    // merge default config with saved config
    const mergedConfig = {
      ...DEFAULT_INSPECTOR_CONFIG,
      ...JSON.parse(savedConfig),
    } as InspectorConfig;

    // update description of keys to match the new description (in case of any updates to the default config description)
    for (const [key, value] of Object.entries(mergedConfig)) {
      mergedConfig[key as keyof InspectorConfig] = {
        ...value,
        label: DEFAULT_INSPECTOR_CONFIG[key as keyof InspectorConfig].label,
      };
    }
    baseConfig = mergedConfig;
  } else {
    baseConfig = DEFAULT_INSPECTOR_CONFIG;
  }
  // Apply query param overrides
  const overrides = getConfigOverridesFromQueryParams(DEFAULT_INSPECTOR_CONFIG);
  return { ...baseConfig, ...overrides };
};
