/**
 * Resolves config file preset refs to ServerConfig for createMcpServer
 */

import type { ServerConfig } from "./composable-test-server.js";
import type {
  ToolDefinition,
  TaskToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  ResourceTemplateDefinition,
} from "./composable-test-server.js";
import { createTestServerInfo } from "./test-server-fixtures.js";
import { resolvePreset } from "./preset-registry.js";
import type { ConfigFile, PresetRef } from "./load-config.js";

function mergeRequiredScopes<T extends { requiredScopes?: string[] }>(
  item: T,
  ref: PresetRef,
): T {
  if (!ref.requiredScopes?.length) {
    return item;
  }
  return { ...item, requiredScopes: ref.requiredScopes };
}

function resolvePresetRefs<T extends { requiredScopes?: string[] }>(
  refs: Array<PresetRef | PresetRef[]> | undefined,
  type: "tool" | "resource" | "resourceTemplate" | "prompt",
): T[] {
  if (!refs || refs.length === 0) return [];
  const result: Array<{ requiredScopes?: string[] }> = [];
  for (const entry of refs) {
    const items = Array.isArray(entry) ? entry : [entry];
    for (const ref of items) {
      const presetName = ref.preset;
      if (!presetName || typeof presetName !== "string") {
        throw new Error(
          `Invalid preset ref: preset must be a non-empty string`,
        );
      }
      const resolved = resolvePreset(type, presetName, ref.params);
      const arr = Array.isArray(resolved) ? resolved : [resolved];
      for (const item of arr) {
        result.push(mergeRequiredScopes(item, ref));
      }
    }
  }
  // The caller pairs `type` with the matching `T`, so each resolved preset is
  // the requested definition kind; TS can't see that correspondence.
  return result as T[];
}

/**
 * Resolve config file to ServerConfig for createMcpServer
 */
export function resolveConfig(config: ConfigFile): ServerConfig {
  const tools = resolvePresetRefs<ToolDefinition | TaskToolDefinition>(
    config.tools,
    "tool",
  );
  const resources = resolvePresetRefs<ResourceDefinition>(
    config.resources,
    "resource",
  );
  const resourceTemplates = resolvePresetRefs<ResourceTemplateDefinition>(
    config.resourceTemplates,
    "resourceTemplate",
  );
  const prompts = resolvePresetRefs<PromptDefinition>(config.prompts, "prompt");

  const serverInfo = createTestServerInfo(
    config.serverInfo.name,
    config.serverInfo.version,
  );

  const transport = config.transport;
  const isHttp =
    transport.type === "streamable-http" || transport.type === "sse";

  const serverConfig: ServerConfig = {
    serverInfo,
    tools: tools.length > 0 ? tools : undefined,
    resources: resources.length > 0 ? resources : undefined,
    resourceTemplates:
      resourceTemplates.length > 0 ? resourceTemplates : undefined,
    prompts: prompts.length > 0 ? prompts : undefined,
    logging: config.logging,
    listChanged: config.listChanged,
    subscriptions: config.subscriptions,
    tasks: config.tasks,
    tasksExtension: config.tasksExtension,
    maxPageSize: config.maxPageSize,
    extensionGatedTools: config.extensionGatedTools,
    serverType: isHttp
      ? (transport.type as "sse" | "streamable-http")
      : undefined,
    port: isHttp ? transport.port : undefined,
  };

  // Normalize the modern flag: `true` is shorthand for the default (dual-era
  // stateless) posture; the object form passes through.
  if (transport.modern !== undefined) {
    serverConfig.modern =
      transport.modern === true ? {} : transport.modern || undefined;
  }

  if (config.oauth) {
    const { issuerUrl, ...oauthRest } = config.oauth;
    serverConfig.oauth = {
      ...oauthRest,
      ...(issuerUrl && { issuerUrl: new URL(issuerUrl) }),
    };
  }

  return serverConfig;
}
