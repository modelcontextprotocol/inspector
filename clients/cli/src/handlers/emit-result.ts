import { awaitableLog } from "../utils/awaitable-log.js";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import type { CliAppInfo, McpResponse, MethodArgs } from "./method-types.js";

/**
 * Write the method result (and any app-info) to stdout, honouring `--format`
 * and `--app-info`, then map `isError`/no-app outcomes onto the exit-code map.
 */
export async function emitResult(
  result: McpResponse,
  appInfo: CliAppInfo | undefined,
  args: MethodArgs,
): Promise<void> {
  const json = args.format === "json";

  if (args.appInfo) {
    const info: CliAppInfo = appInfo ?? {
      hasApp: false,
      toolName: args.toolName ?? "",
    };
    await awaitableLog(JSON.stringify(json ? { appInfo: info } : info) + "\n");
    if (!info.hasApp) {
      throw new CliExitCodeError(
        EXIT_CODES.NO_APP,
        `Tool '${args.toolName}' has no MCP App UI resource (_meta.ui.resourceUri).`,
      );
    }
    return;
  }

  if (json) {
    const envelope: Record<string, unknown> = { result };
    if (appInfo?.hasApp) envelope.appInfo = appInfo;
    await awaitableLog(JSON.stringify(envelope) + "\n");
  } else {
    await awaitableLog(JSON.stringify(result, null, 2) + "\n");
  }

  if ((result as { isError?: unknown }).isError === true) {
    throw new CliExitCodeError(
      EXIT_CODES.TOOL_ERROR,
      `Tool '${args.toolName}' returned isError:true.`,
      { code: "tool_is_error" },
    );
  }
}
