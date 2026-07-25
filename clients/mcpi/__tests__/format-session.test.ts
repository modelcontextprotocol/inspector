import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  formatCallToolResultHuman,
  formatToolsHuman,
  formatResourcesHuman,
  formatResourceTemplatesHuman,
  formatPromptsHuman,
  formatResourceReadHuman,
  formatPromptResultHuman,
  formatCompletionsHuman,
  formatTasksHuman,
  formatTaskHuman,
  formatInitializeHuman,
  formatRootsHuman,
  formatAuthListHuman,
  formatServersListHuman,
  formatServerShowHuman,
  formatSessionsListHuman,
  formatSessionInfoHuman,
  formatAppInfoListHuman,
  formatAppInfoHuman,
  formatStreamEventHuman,
  formatRpcResultHuman,
} from "../src/session/format-human.js";
import { writeSessionOutput } from "../src/session/format-session.js";
import { CliExitCodeError, EXIT_CODES } from "../src/error-handler.js";

describe("format-human", () => {
  it("formats tools with schema variants and empty list", () => {
    expect(formatToolsHuman([])).toContain("(none)");
    const text = formatToolsHuman([
      {
        name: "echo",
        description: "Echo back\nmore",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
            n: { type: "number" },
            tags: { type: "array", items: { type: "string" } },
            extra: { type: "boolean" },
          },
          required: ["message"],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: "types",
        inputSchema: {
          type: "object",
          properties: {
            emptyArr: { type: "array" },
            multi: { type: ["string", "number"] },
            bare: {},
          },
        },
      },
      {
        name: "more",
        inputSchema: {
          type: "object",
          properties: {
            flag: { type: ["boolean", "null"] },
            choice: { enum: ["a", "b"] },
            obj: { type: "object" },
          },
        },
      },
      {
        name: "ints",
        inputSchema: {
          type: "object",
          properties: {
            i: { type: "integer" },
            unknownType: { type: "custom" },
            nonObjProp: "x",
          },
        },
        annotations: {},
      },
      { name: "plain", inputSchema: null },
      { name: "emptyProps", inputSchema: { type: "object", properties: {} } },
      { name: "noProps", inputSchema: { type: "object" } },
      {},
    ]);
    expect(text).toContain("Tools (8):");
    expect(text).toContain("`echo(message:str, n?:num, tags?:[str], …)`");
    expect(text).toContain("[read-only, destructive, idempotent, open-world]");
    expect(text).toContain("emptyArr?:[any]");
    expect(text).toContain("multi?:str | num");
    expect(text).toContain("bare?:any");
    expect(text).toContain("flag?:bool");
    expect(text).toContain("choice?:enum");
    expect(text).toContain("`plain()`");
    expect(text).toContain("`?()`");
  });

  it("formats list helpers for resources, templates, prompts, roots, tasks", () => {
    expect(
      formatResourcesHuman([
        { name: "r", uri: "u://x", description: "d\n2" },
        { uri: "u://only" },
        { name: "n", uri: 1, description: "   " },
        { name: "no-uri" },
      ]),
    ).toContain("`r` (u://x)");
    expect(formatResourcesHuman([])).toContain("(none)");

    expect(
      formatResourceTemplatesHuman([
        { name: "t", uriTemplate: "u://{id}", description: "tpl" },
        { description: "   " },
        { name: "x", uriTemplate: 1 },
      ]),
    ).toContain("u://{id}");
    expect(formatResourceTemplatesHuman([])).toContain("(none)");

    expect(
      formatPromptsHuman([
        { name: "p", description: "hi\nmore" },
        { description: "   " },
        {},
      ]),
    ).toContain("`p`");
    expect(formatPromptsHuman([])).toContain("(none)");

    expect(
      formatRootsHuman([{ uri: "file:///a", name: "a" }, { uri: "file:///b" }]),
    ).toContain("file:///a (a)");
    expect(formatRootsHuman([])).toContain("(none)");

    expect(
      formatTasksHuman([
        { taskId: "1", status: "running", statusMessage: "go" },
        { id: "2", status: "done" },
        {},
      ]),
    ).toContain("`1` running");
    expect(formatTasksHuman([])).toContain("(none)");

    expect(
      formatTaskHuman({
        taskId: "t1",
        status: "ok",
        statusMessage: "fine",
        createdAt: "c",
        lastUpdatedAt: "u",
      }),
    ).toContain("Created: c");
    expect(formatTaskHuman(null)).toContain("Task: `?`");
    expect(formatTaskHuman({})).toContain("Status: ?");
  });

  it("formats call tool results across content block types", () => {
    const structured = { ok: true };
    const withDupe = formatCallToolResultHuman({
      isError: true,
      content: [
        { type: "text", text: JSON.stringify(structured) },
        { type: "text", text: "hello" },
        { type: "text", text: "{not-json" },
        {
          type: "resource_link",
          uri: "u://r",
          name: "n",
          description: "d",
          mimeType: "text/plain",
        },
        { type: "image", mimeType: "image/png", data: "abc" },
        { type: "audio", mimeType: "audio/wav" },
        {
          type: "resource",
          resource: { uri: "u://e", mimeType: "text/plain", text: "body" },
        },
        { type: "custom", x: 1 },
      ],
      structuredContent: structured,
      _meta: { a: 1 },
    });
    expect(withDupe).toContain("Tool error:");
    expect(withDupe).toContain("hello");
    expect(withDupe).toContain("Resource link");
    expect(withDupe).toContain("[Image:");
    expect(withDupe).toContain("[Audio:");
    expect(withDupe).toContain("Embedded resource");
    expect(withDupe).toContain('"x": 1');
    expect(withDupe).not.toContain("Structured content:");

    expect(
      formatCallToolResultHuman({
        isError: true,
        structuredContent: { only: true },
        content: [],
      }),
    ).toContain("Structured content:");

    expect(
      formatCallToolResultHuman({
        content: [{ type: "image" }, { type: "audio", data: "x" }],
      }),
    ).toContain("[Image: unknown");

    expect(
      formatCallToolResultHuman({
        content: [{ type: "resource" }],
      }),
    ).toContain("Embedded resource");

    expect(
      formatCallToolResultHuman({
        content: [
          {
            type: "resource",
            resource: { uri: "u://e" },
          },
        ],
      }),
    ).toContain("URI: u://e");

    expect(
      formatCallToolResultHuman({
        content: [{ type: "resource_link", uri: "u" }],
      }),
    ).toContain("Resource link");

    expect(
      formatCallToolResultHuman({
        content: [{ type: "text" }],
        structuredContent: {},
        _meta: {},
      }),
    ).toContain("Content:");

    expect(formatCallToolResultHuman({})).toBe("(no content)");
  });

  it("formats resource read, prompt get, completions, initialize", () => {
    expect(formatResourceReadHuman({ contents: [] })).toBe("(empty resource)");
    expect(
      formatResourceReadHuman({
        contents: [
          { uri: "u://a", mimeType: "text/plain", text: "hi" },
          { uri: "u://b", blob: "zzzz" },
        ],
      }),
    ).toContain("[Blob:");

    expect(formatPromptResultHuman({})).toBe("(empty prompt)");
    expect(
      formatPromptResultHuman({
        description: "desc",
        messages: [
          { role: "user", content: "plain" },
          {
            role: "assistant",
            content: [{ type: "text", text: "block" }],
          },
          { role: "user", content: { type: "text", text: "obj" } },
        ],
      }),
    ).toContain("[assistant]");

    expect(formatCompletionsHuman({ values: ["a"], hasMore: true })).toContain(
      "(more available)",
    );
    expect(formatCompletionsHuman({ values: [] })).toContain("(none)");

    expect(
      formatInitializeHuman({
        serverInfo: { name: "s", version: "1" },
        protocolVersion: "2025-01-01",
        instructions: " use me ",
        capabilities: { tools: {} },
      }),
    ).toContain("Capabilities: tools");
    expect(formatInitializeHuman({})).toContain("(unknown)");
    expect(
      formatInitializeHuman({
        serverInfo: { name: "s" },
        instructions: "   ",
        capabilities: {},
      }),
    ).toContain("Server: s");
  });

  it("formats admin and app-info helpers", () => {
    expect(
      formatAuthListHuman({
        oauthStatePath: "/tmp/oauth.json",
        servers: [
          {
            url: "https://example.com/mcp",
            hasTokens: true,
            hasRefreshToken: true,
          },
          { url: "https://empty.example/mcp" },
        ],
      }),
    ).toMatch(/Stored auth[\s\S]*example\.com[\s\S]*tokens[\s\S]*no tokens/);
    expect(
      formatAuthListHuman({ oauthStatePath: "/tmp/x", servers: [] }),
    ).toContain("(none)");
    expect(formatServersListHuman([])).toContain("(none)");
    expect(
      formatServersListHuman([{ name: "s", type: "stdio", detail: "x" }]),
    ).toContain("`s`");
    expect(
      formatServersListHuman([
        {
          name: "s",
          type: "stdio",
          detail: "x",
          session: "s",
          isMru: true,
        },
      ]),
    ).toMatch(/@s \(MRU\)/);
    expect(
      formatServerShowHuman({
        name: "s",
        type: "stdio",
        detail: "node x",
        config: { type: "stdio", command: "node" },
      }),
    ).toMatch(/Server[\s\S]*`s`[\s\S]*node x/);

    expect(formatSessionsListHuman([])).toContain("connect first");
    expect(
      formatSessionsListHuman([
        { name: "a", isMru: true, serverIdentity: "id" },
      ]),
    ).toContain("(MRU)");
    expect(
      formatSessionInfoHuman({ name: "a", isMru: true, serverIdentity: "id" }),
    ).toContain("Session `@a`");

    expect(
      formatAppInfoListHuman([
        { toolName: "with", hasApp: true, resourceUri: "ui://x" },
        { toolName: "err", hasApp: false, resourceError: "boom" },
        { toolName: "no", hasApp: false },
      ]),
    ).toContain("no app");

    expect(
      formatAppInfoHuman({
        toolName: "t",
        hasApp: true,
        resourceUri: "ui://x",
        csp: { a: 1 },
      }),
    ).toContain("CSP:");
    expect(
      formatAppInfoHuman({ toolName: "t", hasApp: false, resourceError: "e" }),
    ).toContain("e");
    expect(formatAppInfoHuman({ toolName: "t", hasApp: false })).toContain(
      "No MCP App",
    );
  });

  it("formats stream events and rpc dispatch", () => {
    expect(formatStreamEventHuman(null)).toBe("null");
    expect(formatStreamEventHuman({ type: "subscribed", uri: "u" })).toBe(
      "Subscribed: u",
    );
    expect(
      formatStreamEventHuman({ type: "resources/updated", uri: "u" }),
    ).toBe("Resource updated: u");
    expect(
      formatStreamEventHuman({
        direction: "notification",
        message: {
          method: "notifications/message",
          params: { level: "warn", logger: "L", data: "hi" },
        },
      }),
    ).toBe("[warn] L: hi");
    expect(
      formatStreamEventHuman({
        direction: "notification",
        message: { params: { message: "m" } },
      }),
    ).toBe("[info] m");
    expect(
      formatStreamEventHuman({
        direction: "notification",
        message: { params: { nested: true } },
      }),
    ).toContain("nested");
    expect(
      formatStreamEventHuman({
        direction: "notification",
        message: {},
      }),
    ).toContain("[info]");
    expect(formatStreamEventHuman({ other: 1 })).toContain('"other": 1');
    expect(formatStreamEventHuman("raw")).toBe("raw");

    expect(formatRpcResultHuman("tools/list", { tools: [] })).toContain(
      "Tools",
    );
    expect(formatRpcResultHuman("tools/call", { content: [] })).toBe(
      "(no content)",
    );
    expect(formatRpcResultHuman("resources/list", { resources: [] })).toContain(
      "Resources",
    );
    expect(formatRpcResultHuman("resources/read", { contents: [] })).toBe(
      "(empty resource)",
    );
    expect(
      formatRpcResultHuman("resources/templates/list", {
        resourceTemplates: [],
      }),
    ).toContain("templates");
    expect(formatRpcResultHuman("resources/unsubscribe", { uri: "u" })).toBe(
      "Unsubscribed: u",
    );
    expect(formatRpcResultHuman("prompts/list", { prompts: [] })).toContain(
      "Prompts",
    );
    expect(formatRpcResultHuman("prompts/get", {})).toBe("(empty prompt)");
    expect(formatRpcResultHuman("prompts/complete", { values: [] })).toContain(
      "Completions",
    );
    expect(
      formatRpcResultHuman("initialize", { serverInfo: { name: "s" } }),
    ).toContain("Server: s");
    expect(formatRpcResultHuman("logging/setLevel", {})).toBe(
      "Logging level updated.",
    );
    expect(formatRpcResultHuman("tasks/list", { tasks: [] })).toContain(
      "Tasks",
    );
    expect(
      formatRpcResultHuman("tasks/get", { task: { taskId: "1", status: "x" } }),
    ).toContain("Task: `1`");
    expect(formatRpcResultHuman("tasks/cancel", { taskId: "1" })).toBe(
      "Cancelled task: 1",
    );
    expect(formatRpcResultHuman("tasks/result", { content: [] })).toBe(
      "(no content)",
    );
    expect(formatRpcResultHuman("roots/list", { roots: [] })).toContain(
      "Roots",
    );
    expect(formatRpcResultHuman("roots/set", { roots: [] })).toContain("Roots");
    expect(formatRpcResultHuman("unknown/op", { x: 1 })).toBeNull();
  });
});

describe("writeSessionOutput", () => {
  let stdout: string;
  let original: typeof process.stdout.write;

  beforeEach(() => {
    stdout = "";
    original = process.stdout.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      stdout += typeof chunk === "string" ? chunk : String(chunk);
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = original;
  });

  it("pretty-prints json without a result envelope", async () => {
    await writeSessionOutput(
      { format: "json" },
      {
        kind: "rpc",
        method: "tools/list",
        result: { tools: [] },
      },
    );
    expect(stdout).toBe('{\n  "tools": []\n}\n');
  });

  it("ignores auto-collected appInfo on tools/call json", async () => {
    await writeSessionOutput(
      { format: "json" },
      {
        kind: "rpc",
        method: "tools/call",
        result: { content: [{ type: "text", text: "ok" }] },
        appInfo: { hasApp: false, toolName: "echo" },
      },
    );
    expect(JSON.parse(stdout)).toEqual({
      content: [{ type: "text", text: "ok" }],
    });
  });

  it("throws NO_APP after printing app-info text", async () => {
    await expect(
      writeSessionOutput(
        { format: "text" },
        {
          kind: "rpc",
          method: "tools/call",
          result: { hasApp: false, toolName: "x" },
        },
      ),
    ).rejects.toMatchObject({ exitCode: EXIT_CODES.NO_APP });
    expect(stdout).toContain("has no MCP App");
  });

  it("allows hasApp true app-info probes", async () => {
    await writeSessionOutput(
      { format: "text" },
      {
        kind: "rpc",
        method: "tools/call",
        result: { hasApp: true, toolName: "x", resourceUri: "ui://x" },
      },
    );
    expect(stdout).toContain("has an MCP App");
  });

  it("throws TOOL_ERROR when isError", async () => {
    await expect(
      writeSessionOutput(
        { format: "json" },
        {
          kind: "rpc",
          method: "tools/call",
          result: { isError: true, content: [] },
          toolName: "echo",
        },
      ),
    ).rejects.toBeInstanceOf(CliExitCodeError);
    await expect(
      writeSessionOutput(
        { format: "json" },
        {
          kind: "rpc",
          method: "tools/call",
          result: { isError: true, content: [] },
        },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("tool") });
  });

  it("falls back to pretty JSON for unknown rpc methods in text mode", async () => {
    await writeSessionOutput(
      { format: "text" },
      {
        kind: "rpc",
        method: "custom/x",
        result: { ok: 1 },
      },
    );
    expect(stdout).toContain('"ok": 1');
  });

  it("formats every admin/stream payload kind", async () => {
    const kinds = [
      {
        kind: "ndjson" as const,
        lines: [{ toolName: "a", hasApp: false }],
      },
      { kind: "stream-event" as const, data: { type: "subscribed", uri: "u" } },
      {
        kind: "servers/list" as const,
        servers: [{ name: "s", type: "stdio", detail: "d" }],
      },
      {
        kind: "servers/show" as const,
        server: {
          name: "s",
          type: "stdio",
          detail: "d",
          config: { type: "stdio", command: "n" },
        },
      },
      {
        kind: "sessions/list" as const,
        sessions: [{ name: "a", serverIdentity: "id" }],
      },
      {
        kind: "session" as const,
        session: { name: "a", serverIdentity: "id" },
      },
      { kind: "disconnect" as const, name: "a" },
      {
        kind: "daemon/status" as const,
        status: { pid: 1, socketPath: "/tmp/s", sessions: [] },
      },
      {
        kind: "daemon/status" as const,
        status: { pid: 2, sessions: "bad" },
      },
      {
        kind: "daemon/stop" as const,
        result: { stopping: false },
      },
      {
        kind: "daemon/stop" as const,
        result: { stopping: true },
      },
      {
        kind: "daemon/stop" as const,
        result: { stopping: false, message: "was idle" },
      },
      {
        kind: "auth/list" as const,
        list: {
          oauthStatePath: "/tmp/oauth.json",
          servers: [
            {
              url: "https://example.com/mcp",
              hasTokens: true,
              hasRefreshToken: false,
            },
          ],
        },
      },
      {
        kind: "auth/clear" as const,
        result: { all: true, cleared: 1 },
      },
      {
        kind: "auth/clear" as const,
        result: { all: true, cleared: 2 },
      },
      {
        kind: "auth/clear" as const,
        result: { url: "https://example.com/mcp" },
      },
      { kind: "generic" as const, data: { x: 1 }, title: "Title" },
      { kind: "generic" as const, data: { y: 2 } },
    ];

    for (const payload of kinds) {
      stdout = "";
      await writeSessionOutput({ format: "text" }, payload);
      expect(stdout.length).toBeGreaterThan(0);
      stdout = "";
      await writeSessionOutput({ format: "json" }, payload);
      expect(() => JSON.parse(stdout)).not.toThrow();
    }
  });

  it("defaults undefined format to text", async () => {
    await writeSessionOutput(
      {},
      {
        kind: "disconnect",
        name: "z",
      },
    );
    expect(stdout).toContain("Disconnected `@z`");
  });
});
