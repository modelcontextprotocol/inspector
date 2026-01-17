import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { CompatibilityCallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import {
  AppBridge,
  PostMessageTransport,
  getToolUiResourceUri,
  buildAllowAttribute,
  RESOURCE_MIME_TYPE,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
  type McpUiUpdateModelContextRequest,
  type McpUiMessageRequest,
} from "@modelcontextprotocol/ext-apps/app-bridge";

const IMPLEMENTATION = { name: "MCP Inspector", version: "0.18.0" };

export type ModelContext = McpUiUpdateModelContextRequest["params"];
export type AppMessage = McpUiMessageRequest["params"];

export interface AppBridgeCallbacks {
  onContextUpdate?: (context: ModelContext | null) => void;
  onMessage?: (message: AppMessage) => void;
  onDisplayModeChange?: (mode: "inline" | "fullscreen") => void;
}

export interface UiResourceData {
  html: string;
  csp?: McpUiResourceCsp;
  permissions?: McpUiResourcePermissions;
}

export function getAppTools(tools: Tool[]): Tool[] {
  return tools.filter((tool) => {
    try {
      return !!getToolUiResourceUri(tool);
    } catch {
      return false;
    }
  });
}

export function getToolAppResourceUri(tool: Tool): string | undefined {
  try {
    return getToolUiResourceUri(tool);
  } catch {
    return undefined;
  }
}

export async function getUiResource(
  makeRequest: (uri: string) => Promise<ReadResourceResult>,
  uri: string,
): Promise<UiResourceData> {
  const resource = await makeRequest(uri);

  if (!resource) {
    throw new Error(`Resource not found: ${uri}`);
  }

  if (resource.contents.length !== 1) {
    throw new Error(`Unexpected contents count: ${resource.contents.length}`);
  }

  const content = resource.contents[0];

  if (content.mimeType !== RESOURCE_MIME_TYPE) {
    throw new Error(`Unsupported MIME type: ${content.mimeType}`);
  }

  const html = "blob" in content ? atob(content.blob) : content.text;

  const contentMeta = (content as Record<string, unknown>)._meta as
    | {
        ui?: { csp?: McpUiResourceCsp; permissions?: McpUiResourcePermissions };
      }
    | undefined;
  const csp = contentMeta?.ui?.csp;
  const permissions = contentMeta?.ui?.permissions;

  return { html, csp, permissions };
}

export interface AppBridgeOptions {
  containerDimensions?:
    | { maxHeight?: number; width?: number }
    | { height: number; width?: number };
  displayMode?: "inline" | "fullscreen";
}

export function createAppBridge(
  iframe: HTMLIFrameElement,
  callbacks?: AppBridgeCallbacks,
  options?: AppBridgeOptions,
): AppBridge {
  const appBridge = new AppBridge(
    null,
    IMPLEMENTATION,
    {
      openLinks: {},
      updateModelContext: { text: {} },
    },
    {
      hostContext: {
        containerDimensions: options?.containerDimensions ?? { maxHeight: 600 },
        displayMode: options?.displayMode ?? "inline",
        availableDisplayModes: ["inline", "fullscreen"],
      },
    },
  );

  appBridge.onmessage = async (params) => {
    callbacks?.onMessage?.(params);
    return {};
  };

  appBridge.onopenlink = async (params) => {
    window.open(params.url, "_blank", "noopener,noreferrer");
    return {};
  };

  appBridge.onloggingmessage = (params) => {
    const level =
      params.level === "error"
        ? "error"
        : params.level === "warning"
          ? "warn"
          : "log";
    console[level]("[MCP App]", params.data);
  };

  appBridge.onupdatemodelcontext = async (params) => {
    const hasContent = params.content && params.content.length > 0;
    const hasStructured =
      params.structuredContent &&
      Object.keys(params.structuredContent).length > 0;
    callbacks?.onContextUpdate?.(hasContent || hasStructured ? params : null);
    return {};
  };

  appBridge.onsizechange = async ({ width, height }) => {
    const style = getComputedStyle(iframe);
    const isBorderBox = style.boxSizing === "border-box";

    const from: Keyframe = {};
    const to: Keyframe = {};

    if (width !== undefined) {
      if (isBorderBox) {
        width +=
          parseFloat(style.borderLeftWidth) +
          parseFloat(style.borderRightWidth);
      }
      from.minWidth = `${iframe.offsetWidth}px`;
      iframe.style.minWidth = to.minWidth = `min(${width}px, 100%)`;
    }
    if (height !== undefined) {
      if (isBorderBox) {
        height +=
          parseFloat(style.borderTopWidth) +
          parseFloat(style.borderBottomWidth);
      }
      from.height = `${iframe.offsetHeight}px`;
      iframe.style.height = to.height = `${height}px`;
    }

    iframe.animate([from, to], { duration: 300, easing: "ease-out" });
  };

  appBridge.onrequestdisplaymode = async (params) => {
    const newMode = params.mode === "fullscreen" ? "fullscreen" : "inline";
    appBridge.sendHostContextChange({ displayMode: newMode });
    callbacks?.onDisplayModeChange?.(newMode);
    return { mode: newMode };
  };

  return appBridge;
}

export function setupIframeSandbox(
  iframe: HTMLIFrameElement,
  permissions?: McpUiResourcePermissions,
): void {
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");

  const allowAttribute = buildAllowAttribute(permissions);
  if (allowAttribute) {
    iframe.setAttribute("allow", allowAttribute);
  }
}

function hookInitializedCallback(appBridge: AppBridge): Promise<void> {
  const oninitialized = appBridge.oninitialized;
  return new Promise<void>((resolve) => {
    appBridge.oninitialized = (...args) => {
      resolve();
      appBridge.oninitialized = oninitialized;
      appBridge.oninitialized?.(...args);
    };
  });
}

export async function initializeApp(
  iframe: HTMLIFrameElement,
  appBridge: AppBridge,
  html: string,
  input: Record<string, unknown>,
  resultPromise: Promise<CompatibilityCallToolResult>,
): Promise<void> {
  const appInitializedPromise = hookInitializedCallback(appBridge);

  iframe.srcdoc = html;

  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
  });

  await appBridge.connect(
    new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!),
  );

  await appInitializedPromise;

  appBridge.sendToolInput({ arguments: input });

  resultPromise.then(
    (result) => {
      if ("content" in result && Array.isArray(result.content)) {
        appBridge.sendToolResult(
          result as { content: Array<{ type: "text"; text: string }> },
        );
      } else if ("toolResult" in result) {
        const text =
          typeof result.toolResult === "string"
            ? result.toolResult
            : JSON.stringify(result.toolResult);
        appBridge.sendToolResult({
          content: [{ type: "text" as const, text }],
        });
      }
    },
    (error) => {
      appBridge.sendToolCancelled({
        reason: error instanceof Error ? error.message : String(error),
      });
    },
  );
}
