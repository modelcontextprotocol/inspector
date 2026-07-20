import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { Root } from "@modelcontextprotocol/client";
import {
  ManagedToolsState,
  ManagedResourcesState,
  ManagedResourceTemplatesState,
  ManagedPromptsState,
  ManagedRequestorTasksState,
  MessageLogState,
} from "@inspector/core/mcp/state/index.js";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import { collectAppInfo } from "./collect-app-info.js";
import type {
  CliAppInfo,
  McpResponse,
  MethodArgs,
  MethodOutcome,
} from "./method-types.js";

/**
 * Run one MCP method against a connected {@link InspectorClient}.
 * Shared by one-shot CLI and the session daemon `rpc` path.
 */
export async function runMethod(
  inspectorClient: InspectorClient,
  args: MethodArgs & { method: string },
): Promise<MethodOutcome> {
  let managedToolsState: ManagedToolsState | null = null;
  let managedResourcesState: ManagedResourcesState | null = null;
  let managedResourceTemplatesState: ManagedResourceTemplatesState | null =
    null;
  let managedPromptsState: ManagedPromptsState | null = null;
  let managedTasksState: ManagedRequestorTasksState | null = null;

  try {
    let result: McpResponse;
    let appInfo: CliAppInfo | undefined;

    if (args.method === "tools/list" || args.method === "tools/call") {
      managedToolsState = new ManagedToolsState(inspectorClient);
      managedToolsState.setMetadata(args.metadata);
      await managedToolsState.refresh();
    }

    if (args.method === "resources/list") {
      managedResourcesState = new ManagedResourcesState(inspectorClient);
      managedResourcesState.setMetadata(args.metadata);
      await managedResourcesState.refresh();
    } else if (args.method === "resources/templates/list") {
      managedResourceTemplatesState = new ManagedResourceTemplatesState(
        inspectorClient,
      );
      managedResourceTemplatesState.setMetadata(args.metadata);
      await managedResourceTemplatesState.refresh();
    } else if (args.method === "prompts/list") {
      managedPromptsState = new ManagedPromptsState(inspectorClient);
      managedPromptsState.setMetadata(args.metadata);
      await managedPromptsState.refresh();
    } else if (args.method === "tasks/list") {
      managedTasksState = new ManagedRequestorTasksState(inspectorClient);
      await managedTasksState.refresh();
    }

    if (args.method === "tools/list") {
      const tools = managedToolsState!.getTools();
      if (args.appInfo) {
        const lines: unknown[] = [];
        for (const tool of tools) {
          lines.push(
            await collectAppInfo(inspectorClient, tool, args.metadata),
          );
        }
        return { kind: "ndjson", lines };
      }
      result = { tools };
    } else if (args.method === "tools/call") {
      if (!args.toolName) {
        throw new Error(
          "Tool name is required for tools/call method. Use --tool-name to specify the tool name.",
        );
      }

      const tool = managedToolsState!
        .getTools()
        .find((t) => t.name === args.toolName);
      if (!tool) {
        throw new CliExitCodeError(
          EXIT_CODES.TOOL_ERROR,
          `Tool '${args.toolName}' not found on server.`,
          { code: "tool_not_found" },
        );
      }

      if (args.appInfo || args.format === "json") {
        appInfo = await collectAppInfo(inspectorClient, tool, args.metadata);
      }
      if (args.appInfo) {
        result = { ...appInfo };
      } else {
        const invocation = args.task
          ? await inspectorClient.callToolStream(
              tool,
              args.toolArg || {},
              args.metadata,
              args.toolMeta,
            )
          : await inspectorClient.callTool(
              tool,
              args.toolArg || {},
              args.metadata,
              args.toolMeta,
            );
        if (invocation.result !== null) {
          result = invocation.result;
        } else {
          result = {
            content: [
              {
                type: "text" as const,
                text: invocation.error || "Tool call failed",
              },
            ],
            isError: true,
          };
        }
      }
    } else if (args.method === "resources/list") {
      result = { resources: managedResourcesState!.getResources() };
    } else if (args.method === "resources/read") {
      if (!args.uri) {
        throw new Error(
          "URI is required for resources/read method. Use --uri to specify the resource URI.",
        );
      }
      const invocation = await inspectorClient.readResource(
        args.uri,
        args.metadata,
      );
      result = invocation.result;
    } else if (args.method === "resources/templates/list") {
      result = {
        resourceTemplates:
          managedResourceTemplatesState!.getResourceTemplates(),
      };
    } else if (args.method === "resources/subscribe") {
      if (!args.uri) {
        throw new Error(
          "URI is required for resources/subscribe. Use --uri to specify the resource URI.",
        );
      }
      await inspectorClient.subscribeToResource(args.uri);
      return {
        kind: "stream",
        label: "resources/subscribe",
        start: (writeLine) => {
          writeLine({ type: "subscribed", uri: args.uri });
          const onUpdate = (ev: Event) => {
            const detail = (ev as CustomEvent<{ uri: string }>).detail;
            writeLine({
              type: "resources/updated",
              uri: detail?.uri ?? args.uri,
            });
          };
          inspectorClient.addEventListener("resourceUpdated", onUpdate);
          return () => {
            inspectorClient.removeEventListener("resourceUpdated", onUpdate);
            void inspectorClient.unsubscribeFromResource(args.uri!);
          };
        },
      };
    } else if (args.method === "resources/unsubscribe") {
      if (!args.uri) {
        throw new Error(
          "URI is required for resources/unsubscribe. Use --uri to specify the resource URI.",
        );
      }
      await inspectorClient.unsubscribeFromResource(args.uri);
      result = { unsubscribed: true, uri: args.uri };
    } else if (args.method === "prompts/list") {
      result = { prompts: managedPromptsState!.getPrompts() };
    } else if (args.method === "prompts/get") {
      if (!args.promptName) {
        throw new Error(
          "Prompt name is required for prompts/get method. Use --prompt-name to specify the prompt name.",
        );
      }
      const invocation = await inspectorClient.getPrompt(
        args.promptName,
        args.promptArgs || {},
        args.metadata,
      );
      result = invocation.result;
    } else if (args.method === "prompts/complete") {
      if (!args.completeRefType || !args.completeRef || !args.completeArgName) {
        throw new Error(
          "prompts/complete requires --complete-ref-type, --complete-ref, and --complete-arg-name.",
        );
      }
      const ref =
        args.completeRefType === "ref/prompt"
          ? ({ type: "ref/prompt", name: args.completeRef } as const)
          : ({ type: "ref/resource", uri: args.completeRef } as const);
      result = await inspectorClient.getCompletions(
        ref,
        args.completeArgName,
        args.completeArgValue ?? "",
        undefined,
        args.metadata,
      );
    } else if (args.method === "initialize") {
      result = {
        serverInfo: inspectorClient.getServerInfo(),
        protocolVersion: inspectorClient.getProtocolVersion(),
        capabilities: inspectorClient.getCapabilities(),
        instructions: inspectorClient.getInstructions(),
      };
    } else if (args.method === "logging/setLevel") {
      if (!args.logLevel) {
        throw new Error(
          "Log level is required for logging/setLevel method. Use --log-level to specify the log level.",
        );
      }
      await inspectorClient.setLoggingLevel(args.logLevel);
      result = {};
    } else if (args.method === "logging/tail") {
      return {
        kind: "stream",
        label: "logging/tail",
        start: (writeLine) => {
          const log = new MessageLogState(inspectorClient);
          const onMessage = (ev: Event) => {
            const entry = (ev as CustomEvent).detail as {
              direction?: string;
              message?: { method?: string };
            };
            // Follow server logging notifications only (not full RPC history).
            if (
              entry.direction === "notification" &&
              entry.message?.method === "notifications/message"
            ) {
              writeLine(entry);
            }
          };
          log.addEventListener("message", onMessage);
          return () => {
            log.removeEventListener("message", onMessage);
            log.destroy();
          };
        },
      };
    } else if (args.method === "tasks/list") {
      result = { tasks: managedTasksState!.getTasks() };
    } else if (args.method === "tasks/get") {
      if (!args.taskId) {
        throw new Error("Task id is required for tasks/get. Use --task-id.");
      }
      result = {
        task: await inspectorClient.getRequestorTask(args.taskId),
      };
    } else if (args.method === "tasks/cancel") {
      if (!args.taskId) {
        throw new Error("Task id is required for tasks/cancel. Use --task-id.");
      }
      await inspectorClient.cancelRequestorTask(args.taskId);
      result = { cancelled: true, taskId: args.taskId };
    } else if (args.method === "tasks/result") {
      if (!args.taskId) {
        throw new Error("Task id is required for tasks/result. Use --task-id.");
      }
      // SDK return type is a protocol result object; we only need a JSON bag.
      result = (await inspectorClient.getRequestorTaskResult(
        args.taskId,
      )) as McpResponse;
    } else if (args.method === "roots/list") {
      result = { roots: inspectorClient.getRoots() };
    } else if (args.method === "roots/set") {
      if (!args.rootsJson) {
        throw new Error(
          "roots/set requires --roots-json '<json array of {uri,name?}>'.",
        );
      }
      let roots: Root[];
      try {
        const parsed: unknown = JSON.parse(args.rootsJson);
        if (!Array.isArray(parsed)) {
          throw new Error("must be a JSON array");
        }
        roots = parsed as Root[];
      } catch (e) {
        throw new Error(
          `--roots-json is invalid: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      await inspectorClient.setRoots(roots);
      result = { roots: inspectorClient.getRoots() };
    } else {
      throw new Error(
        `Unsupported method: ${args.method}. Supported methods include: initialize, tools/*, resources/*, prompts/*, logging/*, tasks/*, roots/*.`,
      );
    }

    return { kind: "result", result, appInfo };
  } finally {
    managedToolsState?.destroy();
    managedResourcesState?.destroy();
    managedResourceTemplatesState?.destroy();
    managedPromptsState?.destroy();
    managedTasksState?.destroy();
  }
}
