import { InspectorConfig } from "@/lib/configurationTypes";
import { DEFAULT_INSPECTOR_CONFIG } from "@/lib/constants";
import { API_SERVER_ENV_VARS } from "@modelcontextprotocol/inspector-shared/mcp/remote";

const getSearchParam = (key: string): string | null => {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(key);
  } catch {
    return null;
  }
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

export const getInspectorApiToken = (
  config: InspectorConfig,
): string | undefined => {
  const token = config.MCP_INSPECTOR_API_TOKEN.value as string;
  return token || undefined;
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
  // Read persistent config from localStorage
  const savedPersistentConfig = localStorage.getItem(localStorageKey);
  // Read ephemeral config from sessionStorage
  const savedEphemeralConfig = sessionStorage.getItem(
    `${localStorageKey}_ephemeral`,
  );

  // Start with default config
  let baseConfig = { ...DEFAULT_INSPECTOR_CONFIG };

  // Helper function to filter config to only recognized keys
  const filterRecognizedKeys = (
    parsedConfig: Partial<InspectorConfig>,
  ): Partial<InspectorConfig> => {
    const filtered: Partial<InspectorConfig> = {};

    for (const key in parsedConfig) {
      if (key in DEFAULT_INSPECTOR_CONFIG) {
        filtered[key as keyof InspectorConfig] =
          parsedConfig[key as keyof InspectorConfig];
      }
    }

    return filtered;
  };

  // Apply saved persistent config (filtered to recognized keys only)
  if (savedPersistentConfig) {
    const parsedPersistentConfig = JSON.parse(savedPersistentConfig);
    const filteredPersistentConfig = filterRecognizedKeys(
      parsedPersistentConfig,
    );
    baseConfig = { ...baseConfig, ...filteredPersistentConfig };
  }

  // Apply saved ephemeral config (filtered to recognized keys only)
  if (savedEphemeralConfig) {
    const parsedEphemeralConfig = JSON.parse(savedEphemeralConfig);
    const filteredEphemeralConfig = filterRecognizedKeys(parsedEphemeralConfig);
    baseConfig = { ...baseConfig, ...filteredEphemeralConfig };
  }

  // Ensure all config items have the latest labels/descriptions from defaults
  // (All keys at this point are guaranteed to exist in DEFAULT_INSPECTOR_CONFIG)
  for (const [key, value] of Object.entries(baseConfig)) {
    baseConfig[key as keyof InspectorConfig] = {
      ...value,
      label: DEFAULT_INSPECTOR_CONFIG[key as keyof InspectorConfig].label,
      description:
        DEFAULT_INSPECTOR_CONFIG[key as keyof InspectorConfig].description,
      is_session_item:
        DEFAULT_INSPECTOR_CONFIG[key as keyof InspectorConfig].is_session_item,
    };
  }

  // Apply query param overrides (including API token from URL)
  const overrides = getConfigOverridesFromQueryParams(DEFAULT_INSPECTOR_CONFIG);

  // Check for API token in URL params (API_SERVER_ENV_VARS.AUTH_TOKEN)
  const apiTokenFromUrl = getSearchParam(API_SERVER_ENV_VARS.AUTH_TOKEN);
  if (apiTokenFromUrl) {
    overrides.MCP_INSPECTOR_API_TOKEN = {
      ...DEFAULT_INSPECTOR_CONFIG.MCP_INSPECTOR_API_TOKEN,
      value: apiTokenFromUrl,
    };
  }

  const finalConfig = { ...baseConfig, ...overrides };

  // Persist immediately when we got token from URL so new tabs (e.g. OAuth callback) have it
  if (apiTokenFromUrl) {
    saveInspectorConfig(localStorageKey, finalConfig);
  }

  return finalConfig;
};

export const saveInspectorConfig = (
  localStorageKey: string,
  config: InspectorConfig,
): void => {
  const persistentConfig: Partial<InspectorConfig> = {};
  const ephemeralConfig: Partial<InspectorConfig> = {};

  // Split config based on is_session_item flag
  for (const [key, value] of Object.entries(config)) {
    if (value.is_session_item) {
      ephemeralConfig[key as keyof InspectorConfig] = value;
    } else {
      persistentConfig[key as keyof InspectorConfig] = value;
    }
  }

  // Save persistent config to localStorage
  localStorage.setItem(localStorageKey, JSON.stringify(persistentConfig));

  // Save ephemeral config to sessionStorage
  sessionStorage.setItem(
    `${localStorageKey}_ephemeral`,
    JSON.stringify(ephemeralConfig),
  );
};
