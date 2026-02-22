/**
 * Preset registry for config-driven composable server
 * Maps preset names to fixture factory functions
 */

import type {
  ToolDefinition,
  TaskToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  ResourceTemplateDefinition,
} from "./composable-test-server.js";
import {
  createEchoTool,
  createAddTool,
  createGetSumTool,
  createWriteToStderrTool,
  createCollectSampleTool,
  createListRootsTool,
  createCollectFormElicitationTool,
  createCollectUrlElicitationTool,
  createSendNotificationTool,
  createGetAnnotatedMessageTool,
  createAddResourceTool,
  createRemoveResourceTool,
  createAddToolTool,
  createRemoveToolTool,
  createAddPromptTool,
  createRemovePromptTool,
  createUpdateResourceTool,
  createSendProgressTool,
  createNumberedTools,
  createSimpleTaskTool,
  createProgressTaskTool,
  createElicitationTaskTool,
  createSamplingTaskTool,
  createOptionalTaskTool,
  createForbiddenTaskTool,
  createImmediateReturnTaskTool,
  createArchitectureResource,
  createTestCwdResource,
  createTestEnvResource,
  createTestArgvResource,
  createNumberedResources,
  createFileResourceTemplate,
  createUserResourceTemplate,
  createNumberedResourceTemplates,
  createSimplePrompt,
  createArgsPrompt,
  createNumberedPrompts,
} from "./test-server-fixtures.js";

export type PresetType = "tool" | "resource" | "resourceTemplate" | "prompt";

export type PresetResult =
  | ToolDefinition
  | TaskToolDefinition
  | ResourceDefinition
  | PromptDefinition
  | ResourceTemplateDefinition
  | (ToolDefinition | TaskToolDefinition)[]
  | ResourceDefinition[]
  | ResourceTemplateDefinition[]
  | PromptDefinition[];

function resolveToolPreset(
  name: string,
  params?: Record<string, unknown>,
):
  | ToolDefinition
  | TaskToolDefinition
  | (ToolDefinition | TaskToolDefinition)[] {
  const p = params ?? {};
  const get = (k: string) => p[k] as unknown;
  switch (name) {
    case "echo":
      return createEchoTool();
    case "add":
      return createAddTool();
    case "get_sum":
      return createGetSumTool();
    case "write_to_stderr":
      return createWriteToStderrTool();
    case "collect_sample":
      return createCollectSampleTool();
    case "list_roots":
      return createListRootsTool();
    case "collect_elicitation":
      return createCollectFormElicitationTool();
    case "collect_url_elicitation":
      return createCollectUrlElicitationTool();
    case "send_notification":
      return createSendNotificationTool();
    case "get_annotated_message":
      return createGetAnnotatedMessageTool();
    case "add_resource":
      return createAddResourceTool();
    case "remove_resource":
      return createRemoveResourceTool();
    case "add_tool":
      return createAddToolTool();
    case "remove_tool":
      return createRemoveToolTool();
    case "add_prompt":
      return createAddPromptTool();
    case "remove_prompt":
      return createRemovePromptTool();
    case "update_resource":
      return createUpdateResourceTool();
    case "send_progress":
      return createSendProgressTool(get("name") as string | undefined);
    case "numbered_tools":
      return createNumberedTools(Number(get("count")) || 5);
    case "simple_task":
      return createSimpleTaskTool(
        get("name") as string | undefined,
        Number(get("delayMs")) || undefined,
      );
    case "progress_task":
      return createProgressTaskTool(
        get("name") as string | undefined,
        Number(get("delayMs")) || undefined,
        Number(get("progressUnits")) || undefined,
      );
    case "elicitation_task":
      return createElicitationTaskTool(get("name") as string | undefined);
    case "sampling_task":
      return createSamplingTaskTool(
        get("name") as string | undefined,
        get("samplingText") as string | undefined,
      );
    case "optional_task":
      return createOptionalTaskTool(
        get("name") as string | undefined,
        Number(get("delayMs")) || undefined,
      );
    case "forbidden_task":
      return createForbiddenTaskTool(
        get("name") as string | undefined,
        Number(get("delayMs")) || undefined,
      );
    case "immediate_return_task":
      return createImmediateReturnTaskTool(
        get("name") as string | undefined,
        Number(get("delayMs")) || undefined,
      );
    default:
      throw new Error(`Unknown tool preset: ${name}`);
  }
}

function resolveResourcePreset(
  name: string,
  params?: Record<string, unknown>,
): ResourceDefinition | ResourceDefinition[] {
  const p = params ?? {};
  const get = (k: string) => p[k] as unknown;
  switch (name) {
    case "architecture":
      return createArchitectureResource();
    case "test_cwd":
      return createTestCwdResource();
    case "test_env":
      return createTestEnvResource();
    case "test_argv":
      return createTestArgvResource();
    case "numbered_resources":
      return createNumberedResources(Number(get("count")) || 3);
    default:
      throw new Error(`Unknown resource preset: ${name}`);
  }
}

function resolveResourceTemplatePreset(
  name: string,
  params?: Record<string, unknown>,
): ResourceTemplateDefinition | ResourceTemplateDefinition[] {
  const p = params ?? {};
  const get = (k: string) => p[k] as unknown;
  switch (name) {
    case "file":
      return createFileResourceTemplate();
    case "user":
      return createUserResourceTemplate();
    case "numbered_resource_templates":
      return createNumberedResourceTemplates(Number(get("count")) || 3);
    default:
      throw new Error(`Unknown resource template preset: ${name}`);
  }
}

function resolvePromptPreset(
  name: string,
  params?: Record<string, unknown>,
): PromptDefinition | PromptDefinition[] {
  const p = params ?? {};
  const get = (k: string) => p[k] as unknown;
  switch (name) {
    case "simple_prompt":
      return createSimplePrompt();
    case "args_prompt":
      return createArgsPrompt();
    case "numbered_prompts":
      return createNumberedPrompts(Number(get("count")) || 3);
    default:
      throw new Error(`Unknown prompt preset: ${name}`);
  }
}

/**
 * Resolve a preset by type and name to definition(s)
 */
export function resolvePreset(
  type: PresetType,
  name: string,
  params?: Record<string, unknown>,
): PresetResult {
  switch (type) {
    case "tool":
      return resolveToolPreset(name, params);
    case "resource":
      return resolveResourcePreset(name, params);
    case "resourceTemplate":
      return resolveResourceTemplatePreset(name, params);
    case "prompt":
      return resolvePromptPreset(name, params);
    default:
      throw new Error(`Unknown preset type: ${type}`);
  }
}
