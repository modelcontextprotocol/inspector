import { InspectorClient } from "@inspector/core/mcp/index.js";
import { extractAppInfo } from "@inspector/core/mcp/apps.js";
import type { AppInfo } from "@inspector/core/mcp/apps.js";
import type { CliAppInfo } from "./method-types.js";

/**
 * Build the CLI's app-info for a tool. Never throws — failures fold into
 * `{hasApp:false, resourceError}` so list probes stay per-tool tolerant.
 */
export async function collectAppInfo(
  client: Pick<InspectorClient, "readResource">,
  tool: Parameters<typeof extractAppInfo>[0],
  metadata: Record<string, string> | undefined,
): Promise<CliAppInfo> {
  let base: AppInfo;
  try {
    base = extractAppInfo(tool);
  } catch (e) {
    return {
      hasApp: false,
      toolName: tool.name,
      resourceError: e instanceof Error ? e.message : String(e),
    };
  }
  if (!base.hasApp || base.resourceUri === undefined) return base;
  try {
    const read = await client.readResource(base.resourceUri, metadata);
    return extractAppInfo(tool, read.result);
  } catch (e) {
    return {
      ...base,
      resourceError: e instanceof Error ? e.message : String(e),
    };
  }
}
