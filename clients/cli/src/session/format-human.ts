/**
 * Human-readable (markdown-ish) formatters for the session CLI.
 * Styling (color / bold / dim / OSC 8 links) is parameterized via {@link Style}.
 */

import { PLAIN, type Style } from "./style.js";

type JsonObject = Record<string, unknown>;

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function shortType(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "any";
  const s = schema as JsonObject;
  const t = s.type;
  if (t === "array") {
    if (s.items) return `[${shortType(s.items)}]`;
    return "[any]";
  }
  if (Array.isArray(t)) {
    const filtered = t.filter((x) => x !== "null");
    if (filtered.length === 1) return shortTypeName(String(filtered[0]));
    return filtered.map((x) => shortTypeName(String(x))).join(" | ");
  }
  if (Array.isArray(s.enum)) return "enum";
  if (typeof t === "string") return shortTypeName(t);
  return "any";
}

function shortTypeName(type: string): string {
  const map: Record<string, string> = {
    string: "str",
    number: "num",
    integer: "int",
    boolean: "bool",
    object: "obj",
    array: "[any]",
  };
  return map[type] ?? type;
}

function formatToolParamsInline(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "()";
  const s = schema as JsonObject;
  const properties = s.properties as Record<string, unknown> | undefined;
  if (!properties || Object.keys(properties).length === 0) return "()";
  const required = new Set(asArray<string>(s.required));
  const names = Object.keys(properties);
  const ordered = [
    ...names.filter((n) => required.has(n)),
    ...names.filter((n) => !required.has(n)),
  ];
  const shown = ordered.slice(0, 3);
  const hidden = ordered.length - shown.length;
  const parts = shown.map((name) => {
    const typeStr = shortType(properties[name]);
    return required.has(name) ? `${name}:${typeStr}` : `${name}?:${typeStr}`;
  });
  if (hidden > 0) parts.push("…");
  return `(${parts.join(", ")})`;
}

function toolHints(tool: JsonObject): string | undefined {
  const ann = tool.annotations as JsonObject | undefined;
  if (!ann) return undefined;
  const hints: string[] = [];
  if (ann.readOnlyHint === true) hints.push("read-only");
  if (ann.destructiveHint === true) hints.push("destructive");
  if (ann.idempotentHint === true) hints.push("idempotent");
  if (ann.openWorldHint === true) hints.push("open-world");
  return hints.length > 0 ? hints.join(", ") : undefined;
}

function code(style: Style, name: string): string {
  return `\`${style.bold(name)}\``;
}

function heading(style: Style, text: string): string {
  return style.bold(text);
}

function descSuffix(style: Style, description: unknown): string {
  if (typeof description !== "string" || !description.trim()) return "";
  return style.dim(` — ${description.trim().split("\n")[0]}`);
}

function formatUri(style: Style, uri: string): string {
  if (!uri) return uri;
  if (uri.includes("://")) return style.link(uri);
  return style.cyan(uri);
}

function colorLevel(style: Style, level: string): string {
  switch (level) {
    case "error":
    case "critical":
    case "alert":
    case "emergency":
      return style.red(level);
    case "warning":
      return style.yellow(level);
    case "debug":
    case "notice":
      return style.dim(level);
    default:
      return style.cyan(level);
  }
}

/** Format tools/list for human display. */
export function formatToolsHuman(
  tools: unknown[],
  style: Style = PLAIN,
): string {
  const lines = [heading(style, `Tools (${tools.length}):`)];
  for (const raw of tools) {
    const tool = raw as JsonObject;
    const name = String(tool.name ?? "?");
    const params = formatToolParamsInline(tool.inputSchema);
    const hints = toolHints(tool);
    const hintSuffix = hints ? style.dim(` [${hints}]`) : "";
    lines.push(
      `* \`${style.bold(name)}${style.cyan(params)}\`${hintSuffix}${descSuffix(style, tool.description)}`,
    );
  }
  if (tools.length === 0) lines.push(style.dim("(none)"));
  return lines.join("\n");
}

/** Format resources/list. */
export function formatResourcesHuman(
  resources: unknown[],
  style: Style = PLAIN,
): string {
  const lines = [heading(style, `Resources (${resources.length}):`)];
  for (const raw of resources) {
    const r = raw as JsonObject;
    const name = typeof r.name === "string" ? r.name : String(r.uri ?? "?");
    const uri = typeof r.uri === "string" ? r.uri : "";
    const uriPart = uri ? ` (${formatUri(style, uri)})` : "";
    lines.push(
      `* ${code(style, name)}${uriPart}${descSuffix(style, r.description)}`,
    );
  }
  if (resources.length === 0) lines.push(style.dim("(none)"));
  return lines.join("\n");
}

/** Format resources/templates/list. */
export function formatResourceTemplatesHuman(
  templates: unknown[],
  style: Style = PLAIN,
): string {
  const lines = [heading(style, `Resource templates (${templates.length}):`)];
  for (const raw of templates) {
    const t = raw as JsonObject;
    const name = String(t.name ?? "?");
    const uri = typeof t.uriTemplate === "string" ? t.uriTemplate : "";
    const uriPart = uri ? ` (${formatUri(style, uri)})` : "";
    lines.push(
      `* ${code(style, name)}${uriPart}${descSuffix(style, t.description)}`,
    );
  }
  if (templates.length === 0) lines.push(style.dim("(none)"));
  return lines.join("\n");
}

/** Format prompts/list. */
export function formatPromptsHuman(
  prompts: unknown[],
  style: Style = PLAIN,
): string {
  const lines = [heading(style, `Prompts (${prompts.length}):`)];
  for (const raw of prompts) {
    const p = raw as JsonObject;
    const name = String(p.name ?? "?");
    lines.push(`* ${code(style, name)}${descSuffix(style, p.description)}`);
  }
  if (prompts.length === 0) lines.push(style.dim("(none)"));
  return lines.join("\n");
}

function formatContentBlock(block: JsonObject, style: Style): string[] {
  const lines: string[] = [];
  switch (block.type) {
    case "text":
      lines.push("````");
      lines.push(String(block.text ?? ""));
      lines.push("````");
      break;
    case "resource_link":
      lines.push(heading(style, "Resource link"));
      lines.push(`* URI: ${formatUri(style, String(block.uri ?? ""))}`);
      if (block.name) lines.push(`* Name: ${String(block.name)}`);
      if (block.description)
        lines.push(`* Description: ${String(block.description)}`);
      if (block.mimeType) lines.push(`* MIME type: ${String(block.mimeType)}`);
      break;
    case "image":
      lines.push(
        style.dim(
          `[Image: ${String(block.mimeType ?? "unknown")}${
            typeof block.data === "string"
              ? `, ${block.data.length} chars base64`
              : ""
          }]`,
        ),
      );
      break;
    case "audio":
      lines.push(
        style.dim(
          `[Audio: ${String(block.mimeType ?? "unknown")}${
            typeof block.data === "string"
              ? `, ${block.data.length} chars base64`
              : ""
          }]`,
        ),
      );
      break;
    case "resource": {
      lines.push(heading(style, "Embedded resource"));
      const res = block.resource as JsonObject | undefined;
      if (res) {
        lines.push(`* URI: ${formatUri(style, String(res.uri ?? ""))}`);
        if (res.mimeType) lines.push(`* MIME type: ${String(res.mimeType)}`);
        if (typeof res.text === "string") {
          lines.push("````");
          lines.push(res.text);
          lines.push("````");
        }
      }
      break;
    }
    default:
      lines.push(JSON.stringify(block, null, 2));
  }
  return lines;
}

function findDuplicateTextBlocks(
  content: JsonObject[],
  structuredContent: JsonObject,
): Set<number> {
  const dupes = new Set<number>();
  const canonical = JSON.stringify(structuredContent);
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    if (!block || block.type !== "text" || typeof block.text !== "string")
      continue;
    try {
      const parsed: unknown = JSON.parse(block.text.trim());
      if (JSON.stringify(parsed) === canonical) dupes.add(i);
    } catch {
      // keep
    }
  }
  return dupes;
}

/**
 * Format a CallToolResult (also used for tasks/result) for human display.
 */
export function formatCallToolResultHuman(
  result: JsonObject,
  style: Style = PLAIN,
): string {
  const lines: string[] = [];
  if (result.isError === true) {
    lines.push(style.red(heading(style, "Tool error:")));
  }

  const sc = result.structuredContent as JsonObject | undefined;
  const hasStructuredContent = !!sc && Object.keys(sc).length > 0;
  const content = asArray<JsonObject>(result.content);
  const skipIndices = hasStructuredContent
    ? findDuplicateTextBlocks(content, sc!)
    : new Set<number>();
  const visible = content.filter((_, i) => !skipIndices.has(i));

  if (visible.length > 0) {
    lines.push(heading(style, "Content:"));
    for (let i = 0; i < visible.length; i++) {
      if (i > 0) lines.push("");
      lines.push(...formatContentBlock(visible[i]!, style));
    }
  }

  if (hasStructuredContent && visible.length === 0) {
    if (lines.length > 0) lines.push("");
    lines.push(heading(style, "Structured content:"));
    lines.push(JSON.stringify(sc, null, 2));
  }

  const meta = result._meta as JsonObject | undefined;
  if (meta && Object.keys(meta).length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(style.dim("Metadata:"));
    lines.push(style.dim(JSON.stringify(meta, null, 2)));
  }

  if (lines.length === 0) return style.dim("(no content)");
  return lines.join("\n");
}

/** Format resources/read contents. */
export function formatResourceReadHuman(
  result: JsonObject,
  style: Style = PLAIN,
): string {
  const contents = asArray<JsonObject>(result.contents);
  if (contents.length === 0) return style.dim("(empty resource)");
  const lines: string[] = [
    heading(style, `Resource contents (${contents.length}):`),
  ];
  for (const c of contents) {
    lines.push("");
    lines.push(`URI: ${formatUri(style, String(c.uri ?? ""))}`);
    if (c.mimeType) lines.push(style.dim(`MIME: ${String(c.mimeType)}`));
    if (typeof c.text === "string") {
      lines.push("````");
      lines.push(c.text);
      lines.push("````");
    } else if (typeof c.blob === "string") {
      lines.push(style.dim(`[Blob: ${c.blob.length} chars base64]`));
    }
  }
  return lines.join("\n");
}

/** Format prompts/get. */
export function formatPromptResultHuman(
  result: JsonObject,
  style: Style = PLAIN,
): string {
  const description =
    typeof result.description === "string" ? result.description : undefined;
  const messages = asArray<JsonObject>(result.messages);
  const lines: string[] = [];
  if (description) {
    lines.push(style.dim(description));
    lines.push("");
  }
  lines.push(heading(style, `Messages (${messages.length}):`));
  for (const msg of messages) {
    const role = String(msg.role ?? "?");
    lines.push("");
    lines.push(style.cyan(`[${role}]`));
    const content = msg.content;
    if (typeof content === "string") {
      lines.push("````");
      lines.push(content);
      lines.push("````");
    } else if (content && typeof content === "object") {
      if (Array.isArray(content)) {
        for (const block of content as JsonObject[]) {
          lines.push(...formatContentBlock(block, style));
        }
      } else {
        lines.push(...formatContentBlock(content as JsonObject, style));
      }
    }
  }
  if (messages.length === 0 && !description) return style.dim("(empty prompt)");
  return lines.join("\n");
}

/** Format prompts/complete. */
export function formatCompletionsHuman(
  result: JsonObject,
  style: Style = PLAIN,
): string {
  const values = asArray<string>(result.values);
  const lines = [heading(style, `Completions (${values.length}):`)];
  for (const v of values) lines.push(`* ${v}`);
  if (values.length === 0) lines.push(style.dim("(none)"));
  if (result.hasMore === true) lines.push(style.dim("(more available)"));
  return lines.join("\n");
}

/** Format tasks/list. */
export function formatTasksHuman(
  tasks: unknown[],
  style: Style = PLAIN,
): string {
  const lines = [heading(style, `Tasks (${tasks.length}):`)];
  for (const raw of tasks) {
    const t = raw as JsonObject;
    const id = String(t.taskId ?? t.id ?? "?");
    const status = String(t.status ?? "?");
    const msg =
      typeof t.statusMessage === "string"
        ? style.dim(` — ${t.statusMessage}`)
        : "";
    lines.push(`* ${code(style, id)} ${status}${msg}`);
  }
  if (tasks.length === 0) lines.push(style.dim("(none)"));
  return lines.join("\n");
}

/** Format tasks/get. */
export function formatTaskHuman(task: unknown, style: Style = PLAIN): string {
  const t = (task ?? {}) as JsonObject;
  const lines = [
    `${heading(style, "Task:")} ${code(style, String(t.taskId ?? t.id ?? "?"))}`,
    `Status: ${String(t.status ?? "?")}`,
  ];
  if (typeof t.statusMessage === "string") {
    lines.push(`Message: ${t.statusMessage}`);
  }
  if (t.createdAt) lines.push(style.dim(`Created: ${String(t.createdAt)}`));
  if (t.lastUpdatedAt)
    lines.push(style.dim(`Updated: ${String(t.lastUpdatedAt)}`));
  return lines.join("\n");
}

/** Format initialize / server probe. */
export function formatInitializeHuman(
  result: JsonObject,
  style: Style = PLAIN,
): string {
  const info = (result.serverInfo ?? {}) as JsonObject;
  const lines = [
    `${heading(style, "Server:")} ${style.bold(String(info.name ?? "(unknown)"))}${
      info.version ? style.dim(` v${String(info.version)}`) : ""
    }`,
  ];
  if (result.protocolVersion) {
    lines.push(`Protocol: ${String(result.protocolVersion)}`);
  }
  if (typeof result.instructions === "string" && result.instructions.trim()) {
    lines.push("");
    lines.push(heading(style, "Instructions:"));
    lines.push(result.instructions.trim());
  }
  const caps = result.capabilities;
  if (caps && typeof caps === "object") {
    const keys = Object.keys(caps as JsonObject);
    if (keys.length > 0) {
      lines.push("");
      lines.push(`${heading(style, "Capabilities:")} ${keys.join(", ")}`);
    }
  }
  return lines.join("\n");
}

/** Format roots/list or roots/set. */
export function formatRootsHuman(
  roots: unknown[],
  style: Style = PLAIN,
): string {
  const lines = [heading(style, `Roots (${roots.length}):`)];
  for (const raw of roots) {
    const r = raw as JsonObject;
    const name = typeof r.name === "string" ? style.dim(` (${r.name})`) : "";
    lines.push(`* ${formatUri(style, String(r.uri ?? "?"))}${name}`);
  }
  if (roots.length === 0) lines.push(style.dim("(none)"));
  return lines.join("\n");
}

/** Format auth/list. */
export function formatAuthListHuman(
  list: {
    oauthStatePath?: string;
    servers?: unknown[];
  },
  style: Style = PLAIN,
): string {
  const servers = Array.isArray(list.servers) ? list.servers : [];
  const lines = [
    heading(style, `Stored auth (${servers.length}):`),
    style.dim(String(list.oauthStatePath ?? "")),
  ];
  for (const raw of servers) {
    const s = raw as JsonObject;
    const flags: string[] = [];
    if (s.hasTokens === true) flags.push("tokens");
    if (s.hasRefreshToken === true) flags.push("refresh");
    const flagText =
      flags.length > 0
        ? style.dim(` (${flags.join(", ")})`)
        : style.dim(" (no tokens)");
    lines.push(`* ${code(style, String(s.url))}${flagText}`);
  }
  if (servers.length === 0) lines.push(style.dim("(none)"));
  return lines.join("\n");
}

/** Format servers/list. */
export function formatServersListHuman(
  servers: unknown[],
  style: Style = PLAIN,
): string {
  const lines = [heading(style, `Servers (${servers.length}):`)];
  for (const raw of servers) {
    const s = raw as JsonObject;
    const sessionName =
      typeof s.session === "string" && s.session.length > 0
        ? s.session
        : undefined;
    const sessionMark = sessionName
      ? ` ${style.green(`@${sessionName}`)}${s.isMru === true ? style.green(" (MRU)") : ""}`
      : "";
    lines.push(
      `* ${code(style, String(s.name))} ${style.dim(`[${String(s.type)}]`)} ${style.dim(String(s.detail ?? ""))}${sessionMark}`,
    );
  }
  if (servers.length === 0) lines.push(style.dim("(none)"));
  return lines.join("\n");
}

/** Format servers/show (one catalog entry). */
export function formatServerShowHuman(
  server: JsonObject,
  style: Style = PLAIN,
): string {
  const name = String(server.name ?? "?");
  const type = String(server.type ?? "?");
  const detail = String(server.detail ?? "");
  const header = `${heading(style, "Server")} ${code(style, name)} ${style.dim(`[${type}]`)}`;
  const body: Record<string, unknown> = {};
  if (server.config && typeof server.config === "object") {
    body.config = server.config;
  }
  if (server.settings && typeof server.settings === "object") {
    body.settings = server.settings;
  }
  return [
    header,
    detail ? style.dim(detail) : style.dim("(no detail)"),
    JSON.stringify(body, null, 2),
  ].join("\n");
}

/** Format sessions/list. */
export function formatSessionsListHuman(
  sessions: unknown[],
  style: Style = PLAIN,
): string {
  const lines = [heading(style, `Sessions (${sessions.length}):`)];
  for (const raw of sessions) {
    const s = raw as JsonObject;
    const mru = s.isMru === true ? style.green(" (MRU)") : "";
    lines.push(
      `* ${code(style, `@${String(s.name)}`)}${mru}${style.dim(` — ${String(s.serverIdentity ?? "")}`)}`,
    );
  }
  if (sessions.length === 0) lines.push(style.dim("(none — connect first)"));
  return lines.join("\n");
}

/** Format a single session info (connect / sessions/use). */
export function formatSessionInfoHuman(
  session: JsonObject,
  style: Style = PLAIN,
): string {
  const mru = session.isMru === true ? style.green(" (MRU)") : "";
  return [
    `${heading(style, "Session")} ${code(style, `@${String(session.name)}`)}${mru}`,
    `Server: ${style.dim(String(session.serverIdentity ?? ""))}`,
  ].join("\n");
}

/** Format tools/list --app-info lines. */
export function formatAppInfoListHuman(
  lines: unknown[],
  style: Style = PLAIN,
): string {
  const out = [heading(style, `App info (${lines.length} tools):`)];
  for (const raw of lines) {
    const info = raw as JsonObject;
    const name = String(info.toolName ?? "?");
    if (info.hasApp === true) {
      const uri = String(info.resourceUri ?? "ui://?");
      out.push(
        `* ${code(style, name)} — ${style.green("app")} (${formatUri(style, uri)})`,
      );
    } else {
      const err =
        typeof info.resourceError === "string"
          ? style.dim(` — ${info.resourceError}`)
          : style.dim(" — no app");
      out.push(`* ${code(style, name)}${err}`);
    }
  }
  return out.join("\n");
}

/** Format a single app-info probe. */
export function formatAppInfoHuman(
  info: JsonObject,
  style: Style = PLAIN,
): string {
  const name = String(info.toolName ?? "?");
  if (info.hasApp === true) {
    const lines = [
      `Tool ${code(style, name)} ${style.green("has an MCP App")}`,
      `Resource: ${formatUri(style, String(info.resourceUri ?? ""))}`,
    ];
    if (info.csp) lines.push(style.dim(`CSP: ${JSON.stringify(info.csp)}`));
    return lines.join("\n");
  }
  const err =
    typeof info.resourceError === "string"
      ? info.resourceError
      : "No MCP App UI resource (_meta.ui.resourceUri).";
  return `Tool ${code(style, name)} ${style.red("has no MCP App")}\n${style.dim(err)}`;
}

/** Format a stream event for human display. */
export function formatStreamEventHuman(
  data: unknown,
  style: Style = PLAIN,
): string {
  if (!data || typeof data !== "object") return String(data);
  const ev = data as JsonObject;
  if (ev.type === "subscribed") {
    return `${heading(style, "Subscribed:")} ${formatUri(style, String(ev.uri ?? ""))}`;
  }
  if (ev.type === "resources/updated") {
    return `${heading(style, "Resource updated:")} ${formatUri(style, String(ev.uri ?? ""))}`;
  }
  // logging/tail MessageEntry-shaped
  if (ev.direction === "notification" && ev.message) {
    const msg = ev.message as JsonObject;
    const params = (msg.params ?? {}) as JsonObject;
    const level = String(params.level ?? "info");
    const logger = params.logger ? style.dim(` ${String(params.logger)}:`) : "";
    const text = String(
      params.data ?? params.message ?? JSON.stringify(params),
    );
    return `[${colorLevel(style, level)}]${logger} ${text}`;
  }
  return JSON.stringify(ev, null, 2);
}

/**
 * Dispatch human formatting for an RPC method result.
 * Returns null when the caller should fall back to pretty JSON.
 */
export function formatRpcResultHuman(
  method: string,
  result: JsonObject,
  style: Style = PLAIN,
): string | null {
  switch (method) {
    case "tools/list":
      return formatToolsHuman(asArray(result.tools), style);
    case "tools/call":
      return formatCallToolResultHuman(result, style);
    case "resources/list":
      return formatResourcesHuman(asArray(result.resources), style);
    case "resources/read":
      return formatResourceReadHuman(result, style);
    case "resources/templates/list":
      return formatResourceTemplatesHuman(
        asArray(result.resourceTemplates),
        style,
      );
    case "resources/unsubscribe":
      return `${heading(style, "Unsubscribed:")} ${formatUri(style, String(result.uri ?? ""))}`;
    case "prompts/list":
      return formatPromptsHuman(asArray(result.prompts), style);
    case "prompts/get":
      return formatPromptResultHuman(result, style);
    case "prompts/complete":
      return formatCompletionsHuman(result, style);
    case "initialize":
      return formatInitializeHuman(result, style);
    case "logging/setLevel":
      return style.green("Logging level updated.");
    case "tasks/list":
      return formatTasksHuman(asArray(result.tasks), style);
    case "tasks/get":
      return formatTaskHuman(result.task, style);
    case "tasks/cancel":
      return `${heading(style, "Cancelled task:")} ${String(result.taskId ?? "")}`;
    case "tasks/result":
      return formatCallToolResultHuman(result, style);
    case "roots/list":
    case "roots/set":
      return formatRootsHuman(asArray(result.roots), style);
    default:
      return null;
  }
}
