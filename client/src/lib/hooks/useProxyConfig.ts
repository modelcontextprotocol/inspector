/**
 * Hook to get proxy configuration from config
 */
import { useMemo } from "react";
import { InspectorConfig } from "../configurationTypes";
import { getMCPProxyAddress, getMCPProxyAuthToken } from "@/utils/configUtils";

// This hook can be used if we need to get config from context
// For now, it's simpler to just pass the config values directly
export function useProxyConfig(config?: InspectorConfig) {
  const proxyFullAddress = useMemo(
    () => (config ? getMCPProxyAddress(config) : ""),
    [config],
  );

  const proxyAuthToken = useMemo(
    () => (config ? getMCPProxyAuthToken(config) : ""),
    [config],
  );

  return { proxyFullAddress, proxyAuthToken };
}
