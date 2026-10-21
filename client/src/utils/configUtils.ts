import { InspectorConfig } from "@/lib/configurationTypes";
import {
  DEFAULT_MCP_PROXY_LISTEN_PORT,
  DEFAULT_INSPECTOR_CONFIG,
} from "@/lib/constants";
import { isOAuthCallbackPath } from "@/lib/oauthConnectionSnapshot";

// The OAuth callback routes are reached by a redirect from the authorization
// server, so their query string is not under the user's control and no
// connection setting is taken from it (see lib/oauthConnectionSnapshot.ts).
// Only `code`/`state`/`error` are read there, separately.

const getSearchParam = (key: string): string | null => {
  if (isOAuthCallbackPath()) return null;
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(key);
  } catch {
    return null;
  }
};

export const getMCPProxyAddress = (config: InspectorConfig): string => {
  let proxyFullAddress = config.MCP_PROXY_FULL_ADDRESS.value as string;
  if (proxyFullAddress) {
    proxyFullAddress = proxyFullAddress.replace(/\/+$/, "");
    return proxyFullAddress;
  }

  // Check for proxy port from query params, fallback to default. Only a
  // plain port number is accepted, so the param cannot change the host.
  const portParam = getSearchParam("MCP_PROXY_PORT");
  const proxyPort =
    portParam && /^\d{1,5}$/.test(portParam)
      ? portParam
      : DEFAULT_MCP_PROXY_LISTEN_PORT;

  return `${window.location.protocol}//${window.location.hostname}:${proxyPort}`;
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

export const getMCPProxyAuthToken = (
  config: InspectorConfig,
): {
  token: string;
  header: string;
} => {
  return {
    token: config.MCP_PROXY_AUTH_TOKEN.value as string,
    header: "X-MCP-Proxy-Auth",
  };
};
export const getMCPTaskTtl = (config: InspectorConfig): number => {
  return config.MCP_TASK_TTL.value as number;
};

export const getInitialTransportType = ():
  "stdio" | "sse" | "streamable-http" => {
  const param = getSearchParam("transport");
  if (param === "stdio" || param === "sse" || param === "streamable-http") {
    return param;
  }
  return (
    (localStorage.getItem("lastTransportType") as
      "stdio" | "sse" | "streamable-http") || "stdio"
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
  const overrides: Partial<InspectorConfig> = {};
  if (isOAuthCallbackPath()) return overrides;
  const url = new URL(window.location.href);
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

const normalizeProxyAddress = (address: unknown): string =>
  typeof address === "string" ? address.trim().replace(/\/+$/, "") : "";

// The proxy address supplied by a query string in this tab, if it differs
// from the one saved in localStorage. It is kept in sessionStorage only (so it
// survives a same-tab navigation such as the OAuth redirect) and is never
// written to localStorage, so a link cannot change the address that a later
// session (e.g. one opened by the launcher with a fresh token) uses.
let queryOnlyProxyAddress: string | null = null;

const sessionProxyAddressKey = (localStorageKey: string) =>
  `${localStorageKey}_session_proxy_address`;

export const initializeInspectorConfig = (
  localStorageKey: string,
): InspectorConfig => {
  queryOnlyProxyAddress = null;
  // Read persistent config from localStorage
  const savedPersistentConfig = localStorage.getItem(localStorageKey);
  // Read ephemeral config from sessionStorage
  const savedEphemeralConfig = sessionStorage.getItem(
    `${localStorageKey}_ephemeral`,
  );

  // Start with default config
  let baseConfig = { ...DEFAULT_INSPECTOR_CONFIG };

  // Apply saved persistent config
  if (savedPersistentConfig) {
    const parsedPersistentConfig = JSON.parse(savedPersistentConfig);
    baseConfig = { ...baseConfig, ...parsedPersistentConfig };
  }

  // Apply saved ephemeral config
  if (savedEphemeralConfig) {
    const parsedEphemeralConfig = JSON.parse(savedEphemeralConfig);
    baseConfig = { ...baseConfig, ...parsedEphemeralConfig };
  }

  // Ensure all config items have the latest labels/descriptions from defaults
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

  // Apply query param overrides
  const overrides = getConfigOverridesFromQueryParams(DEFAULT_INSPECTOR_CONFIG);
  const config = { ...baseConfig, ...overrides };

  // The proxy session token is only sent to a proxy address the user already
  // has saved, or to one supplied together with the token in the same URL
  // (e.g. `?MCP_PROXY_FULL_ADDRESS=...&MCP_PROXY_AUTH_TOKEN=...`). When the
  // query sets a different address without a token, drop the saved token so
  // it is not sent there; the user can enter one in the configuration panel.
  const queryAddressItem = overrides.MCP_PROXY_FULL_ADDRESS;
  const queryAddress = normalizeProxyAddress(queryAddressItem?.value);
  const savedAddress = normalizeProxyAddress(
    baseConfig.MCP_PROXY_FULL_ADDRESS.value,
  );
  if (queryAddressItem && queryAddress && queryAddress !== savedAddress) {
    queryOnlyProxyAddress = queryAddressItem.value as string;
    if (!overrides.MCP_PROXY_AUTH_TOKEN) {
      config.MCP_PROXY_AUTH_TOKEN = {
        ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_AUTH_TOKEN,
      };
    }
  } else if (!queryAddressItem && !overrides.MCP_PROXY_AUTH_TOKEN) {
    // No proxy settings in this URL (e.g. the OAuth callback): keep using the
    // address this tab was given earlier, together with the token stored for
    // it. A URL carrying only a token (the launcher's shape) is meant for the
    // saved/default proxy, so it does not pick up the tab's address.
    const sessionAddress = sessionStorage.getItem(
      sessionProxyAddressKey(localStorageKey),
    );
    if (
      sessionAddress &&
      normalizeProxyAddress(sessionAddress) !== savedAddress
    ) {
      queryOnlyProxyAddress = sessionAddress;
      config.MCP_PROXY_FULL_ADDRESS = {
        ...config.MCP_PROXY_FULL_ADDRESS,
        value: sessionAddress,
      };
    }
  }

  return config;
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

  // Don't persist a proxy address that only came from a query string; keep
  // it for this tab in sessionStorage and keep whatever was saved before in
  // localStorage.
  if (
    queryOnlyProxyAddress !== null &&
    config.MCP_PROXY_FULL_ADDRESS?.value === queryOnlyProxyAddress
  ) {
    sessionStorage.setItem(
      sessionProxyAddressKey(localStorageKey),
      queryOnlyProxyAddress,
    );
    const saved = localStorage.getItem(localStorageKey);
    let savedAddress: InspectorConfig["MCP_PROXY_FULL_ADDRESS"] | undefined;
    try {
      savedAddress = saved
        ? JSON.parse(saved).MCP_PROXY_FULL_ADDRESS
        : undefined;
    } catch {
      savedAddress = undefined;
    }
    if (savedAddress) {
      persistentConfig.MCP_PROXY_FULL_ADDRESS = savedAddress;
    } else {
      delete persistentConfig.MCP_PROXY_FULL_ADDRESS;
    }
  } else {
    sessionStorage.removeItem(sessionProxyAddressKey(localStorageKey));
  }

  // Save persistent config to localStorage
  localStorage.setItem(localStorageKey, JSON.stringify(persistentConfig));

  // Save ephemeral config to sessionStorage
  sessionStorage.setItem(
    `${localStorageKey}_ephemeral`,
    JSON.stringify(ephemeralConfig),
  );
};
