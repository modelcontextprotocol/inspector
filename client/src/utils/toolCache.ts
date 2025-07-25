import { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface CacheKey {
  serverUrl: string;
  toolName: string;
  paramNames: string[];
}

export function generateCacheKey(
  serverUrl: string,
  toolName: string,
  tool: Tool,
): string {
  const paramNames = Object.keys(tool.inputSchema.properties ?? {}).sort();
  const key = `tool_params_${btoa(`${serverUrl}_${toolName}_${JSON.stringify(paramNames)}`)}`;
  return key;
}

export function saveToolParamsForCache(
  serverUrl: string,
  toolName: string,
  tool: Tool,
  params: Record<string, unknown>,
): void {
  try {
    const cacheKey = generateCacheKey(serverUrl, toolName, tool);
    const cacheData = {
      params,
      timestamp: Date.now(),
      toolName,
      serverUrl,
    };
    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
  } catch (error) {
    console.warn("Failed to save tool parameters to cache:", error);
  }
}

export function loadToolParamsFromCache(
  serverUrl: string,
  toolName: string,
  tool: Tool,
): Record<string, unknown> | null {
  try {
    const cacheKey = generateCacheKey(serverUrl, toolName, tool);
    const cached = localStorage.getItem(cacheKey);

    if (!cached) {
      return null;
    }

    const cacheData = JSON.parse(cached);

    // Validate cache data structure
    if (!cacheData.params || !cacheData.timestamp) {
      return null;
    }

    // Optional: Check if cache is too old (e.g., 30 days)
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
    if (Date.now() - cacheData.timestamp > maxAge) {
      localStorage.removeItem(cacheKey);
      return null;
    }

    return cacheData.params;
  } catch (error) {
    console.warn("Failed to load tool parameters from cache:", error);
    return null;
  }
}
