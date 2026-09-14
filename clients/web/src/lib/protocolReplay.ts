import type {
  LoggingMessageNotification,
  Tool,
} from "@modelcontextprotocol/client";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { JsonValue } from "@inspector/core/mcp/index.js";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
// Type-only, so this creates no runtime edge into `components/` and the
// `components → lib → utils` direction still holds: `LogEntryData` is the shape
// the Logs screen renders, and this module exists to produce exactly that.
import type { LogEntryData } from "../components/elements/LogEntry/LogEntry";
import {
  coercedArgumentNames,
  coercedArgumentsError,
} from "@inspector/core/json/jsonUtils.js";
import { isReplayableProtocolMethod } from "../utils/replayableProtocolMethods";

// Derive `LogEntryData[]` from the MessageLog by filtering for the
// `notifications/message` notifications the server emits in response to
// `logging/setLevel`. The Logs screen renders these; we transform here
// rather than in the screen so the view stays prop-driven.
export function messagesToLogEntries(messages: MessageEntry[]): LogEntryData[] {
  const out: LogEntryData[] = [];
  for (const m of messages) {
    if (m.direction !== "notification") continue;
    // MessageEntry.message is a JSONRPC union; notifications have `method`
    // but not `id`. Narrow with an `in` check, then confirm the method.
    if (!("method" in m.message)) continue;
    if (m.message.method !== "notifications/message") continue;
    // The method check pins this to a logging notification; its `params` are
    // only generically typed on the JSONRPC union, so cast just that value.
    const params = m.message.params as LoggingMessageNotification["params"];
    out.push({
      receivedAt: m.timestamp,
      params,
    });
  }
  return out;
}

// Re-issue the original request behind a Protocol entry. The call goes through
// InspectorClient → tracked transport → message log, so the replayed
// request+response surface as a fresh Protocol entry (protocol-local) — it
// intentionally does NOT touch the Tools/Prompts/Resources panels. Returns a
// human-readable reason when the entry can't be replayed (unsupported method,
// or a tool that's no longer present), or null on a dispatched replay.
/**
 * The slice of `InspectorClient` a replay actually reaches. Naming it — rather
 * than taking the whole client — is what lets a caller (and a test) supply a
 * value that satisfies the real contract instead of casting one in.
 */
export type ReplayClient = Pick<
  InspectorClient,
  | "callTool"
  | "getPrompt"
  | "readResource"
  | "listTools"
  | "listPrompts"
  | "listResources"
  | "listResourceTemplates"
  | "listRequestorTasks"
  | "ping"
>;

/**
 * Params supplied by the Edit-and-replay editor, in place of the entry's own
 * (#2151).
 *
 * `undefined` and `null` are **not** interchangeable, which is why this is not
 * just an optional object: `undefined` means the user did not edit anything —
 * replay the entry verbatim — while `null` means they cleared the editor, which
 * is a legitimate replay of a params-less request. Collapsing the two would
 * make an emptied editor silently re-send the original params.
 */
export type ReplayParamsOverride = Record<string, unknown> | null | undefined;

/**
 * The params of a replayed request that `replayProtocolRequest` actually reads,
 * per method.
 *
 * This is the other half of the switch below, and the two must move together.
 * Replay does not re-send a captured frame verbatim — it dispatches through the
 * typed `InspectorClient` methods, which take named arguments. Everything those
 * signatures have no room for is dropped: `_meta` on any method (a captured
 * `tools/call` carries `_meta.progressToken`), and every key of a list request
 * other than `cursor`.
 *
 * That is invisible and harmless for one-click Replay, which re-sends what it
 * was given. It is neither once the params are put in front of the user to
 * edit (#2151): an editor showing `_meta` invites them to change it, and Send
 * would then transmit something other than what they were looking at. So the
 * Edit-and-replay modal seeds from *this* rather than from the raw frame, and
 * names what it left out.
 */
export function replayableParams(
  method: string,
  params: Record<string, unknown> | undefined,
): { params: Record<string, unknown> | undefined; dropped: string[] } {
  if (!params) return { params: undefined, dropped: [] };

  const keep = (...names: string[]): string[] =>
    names.filter((name) => Object.hasOwn(params, name));

  let kept: string[];
  switch (method) {
    case "tools/call":
    case "prompts/get":
      kept = keep("name", "arguments");
      break;
    case "resources/read":
      kept = keep("uri");
      break;
    case "tools/list":
    case "prompts/list":
    case "resources/list":
    case "resources/templates/list":
    case "tasks/list":
      // Only a *string* cursor survives: the dispatcher ignores any other type,
      // so keeping it would put a value in the editor that changes nothing.
      //
      // An **empty** string is a cursor like any other, and every one of these
      // five adapters now builds its params with `cursor !== undefined` (#2220
      // brought the other four into line with `listTools`), so `""` reaches the
      // wire on all of them and is reported as kept rather than dropped.
      kept = typeof params.cursor === "string" ? ["cursor"] : [];
      break;
    default:
      // `ping` takes nothing, and an unreplayable method never reaches here.
      kept = [];
      break;
  }

  const dropped = Object.keys(params).filter((name) => !kept.includes(name));
  // `fromEntries`, never an assignment loop: an argument legitimately named
  // `__proto__` would otherwise reach the prototype setter.
  return {
    params:
      kept.length > 0
        ? Object.fromEntries(kept.map((name) => [name, params[name]]))
        : undefined,
    dropped,
  };
}

/**
 * A param the dispatch below would *reshape* on the way out, or null when every
 * kept param is sent as written.
 *
 * {@link replayableParams} answers which keys survive; this answers whether the
 * surviving ones survive *intact*. Only `arguments` can fail that, and it fails
 * three ways, each of which the Edit-and-replay editor has to catch before
 * Send:
 *
 * - `arguments: null` is nullish, so `?? {}` replaces it — the editor shows
 *   `null` and the wire carries `{}`.
 * - `arguments: [1,2]` or `arguments: 4` is not nullish, so the cast carries it
 *   through unchanged into a call whose type says it is a named-argument
 *   record. Nothing reshapes it, but nothing can send it either.
 * - For **`prompts/get`**, a non-string *value*. `getPrompt` runs
 *   `convertPromptArguments`, which `JSON.stringify`s anything that is not
 *   already a string — so `{"count": 2}` is sent as `{"count": "2"}` while the
 *   editor still shows the number. This is not a quirk to route around: the
 *   spec types `GetPromptRequest.params.arguments` as `Record<string, string>`,
 *   so a string is the only thing a prompt argument can be.
 * - For **`tools/call`**, the mirror image. `callTool` runs every *string*
 *   entry through `convertToolParameters`, because the widget form hands
 *   everything over as text — so `{"count": "2"}` against a schema declaring a
 *   number is sent as `{"count": 2}`. Detected by running that same conversion
 *   and comparing, rather than by reimplementing its rules, so the two cannot
 *   drift. Needs the `tool`; without one this check is skipped, since nothing
 *   can be said about a coercion whose schema is unknown.
 *
 *   The Tools and Apps tabs' own "Edit as JSON" switch refuses the identical
 *   draft, through the identical helper (#2171). Both are JSON documents whose
 *   values already carry their types, so in both the conversion would send
 *   something other than what the editor showed — and one of the two answering
 *   differently is the inconsistency #2171 was filed to remove.
 *
 * `name` and `uri` are deliberately not checked here: the dispatch already
 * refuses a missing or non-string one with a reason the caller surfaces as a
 * toast, so those fail visibly rather than silently.
 */
export function reshapedReplayParam(
  method: string,
  params: Record<string, unknown> | undefined,
  tool?: Tool,
): string | null {
  if (!params) return null;
  if (method !== "tools/call" && method !== "prompts/get") return null;
  if (!Object.hasOwn(params, "arguments")) return null;
  const args = params.arguments;
  const isRecord =
    args !== null && typeof args === "object" && !Array.isArray(args);
  if (!isRecord) {
    return args === null
      ? "`arguments` is sent as `{}` when null — remove it, or give it an object"
      : "`arguments` must be a JSON object (`{ … }`)";
  }
  if (method === "prompts/get") {
    const coerced = Object.entries(args as Record<string, unknown>)
      .filter(([, value]) => typeof value !== "string")
      .map(([key]) => `\`${key}\``);
    if (coerced.length > 0) {
      return `A prompt argument is always a string — ${coerced.join(", ")} would be sent as JSON text`;
    }
  }
  if (method === "tools/call" && tool) {
    // The same check the Tools/Apps form's raw-JSON editor makes, from the same
    // helper, so the two JSON-authoring surfaces cannot disagree about which
    // drafts are sendable (#2171).
    const coerced = coercedArgumentNames(
      tool.inputSchema,
      args as Record<string, unknown>,
    );
    if (coerced.length > 0) {
      return coercedArgumentsError(coerced, tool.name);
    }
  }
  return null;
}

export async function replayProtocolRequest(
  client: ReplayClient,
  method: string,
  params: Record<string, unknown> | undefined,
  tools: Tool[],
): Promise<string | null> {
  // Gate on the shared replayable-method set (the same one ProtocolEntry uses to
  // show/hide the Replay button) so the two can't drift.
  if (!isReplayableProtocolMethod(method)) {
    return `Replay isn't supported for "${method}".`;
  }
  // Pagination cursor carried by the */list requests; replaying the same page
  // reproduces the original call.
  const cursor = typeof params?.cursor === "string" ? params.cursor : undefined;
  switch (method) {
    case "tools/call": {
      const name = typeof params?.name === "string" ? params.name : undefined;
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        return `Tool "${name ?? "?"}" is no longer available to replay.`;
      }
      await client.callTool(
        tool,
        (params?.arguments ?? {}) as Record<string, JsonValue>,
      );
      return null;
    }
    case "prompts/get": {
      const name = typeof params?.name === "string" ? params.name : undefined;
      if (!name) return "Prompt name is missing; cannot replay.";
      await client.getPrompt(
        name,
        (params?.arguments ?? {}) as Record<string, JsonValue>,
      );
      return null;
    }
    case "resources/read": {
      const uri = typeof params?.uri === "string" ? params.uri : undefined;
      if (!uri) return "Resource URI is missing; cannot replay.";
      await client.readResource(uri);
      return null;
    }
    case "tools/list":
      await client.listTools(cursor);
      return null;
    case "prompts/list":
      await client.listPrompts(cursor);
      return null;
    case "resources/list":
      await client.listResources(cursor);
      return null;
    case "resources/templates/list":
      await client.listResourceTemplates(cursor);
      return null;
    case "tasks/list":
      await client.listRequestorTasks(cursor);
      return null;
    case "ping":
      await client.ping();
      return null;
    /* v8 ignore start -- unreachable: the guard above admits exactly the nine
       methods this switch enumerates. Kept so a method added to
       REPLAYABLE_PROTOCOL_METHODS without a case here reports a reason rather
       than silently resolving as a dispatched replay. */
    default:
      return `Replay isn't supported for "${method}".`;
    /* v8 ignore stop */
  }
}
