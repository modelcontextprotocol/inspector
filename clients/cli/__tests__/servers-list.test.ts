import { describe, it, expect, afterEach } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import {
  createSampleTestConfig,
  deleteConfigFile,
} from "./helpers/fixtures.js";
import { expectCliSuccess } from "./helpers/assertions.js";
import { runMcp } from "./helpers/mcp-runner.js";
import {
  annotateServerEntriesWithSessions,
  listServerEntries,
  sanitizeServerConfig,
  sanitizeServerSettings,
  showServerEntry,
  summarizeServerConfig,
} from "../src/handlers/servers-list.js";
import type {
  InspectorServerSettings,
  MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import { expectCliFailure } from "./helpers/assertions.js";

describe("summarizeServerConfig", () => {
  it("summarises stdio, sse, and streamable-http configs", () => {
    expect(
      summarizeServerConfig({
        type: "stdio",
        command: "node",
        args: ["server.js"],
      }),
    ).toEqual({ type: "stdio", detail: "node server.js" });
    expect(
      summarizeServerConfig({
        type: "stdio",
        command: "node",
      }),
    ).toEqual({ type: "stdio", detail: "node" });
    expect(
      summarizeServerConfig({
        type: "sse",
        url: "http://localhost/sse",
      }),
    ).toEqual({ type: "sse", detail: "http://localhost/sse" });
    expect(
      summarizeServerConfig({
        type: "streamable-http",
        url: "http://localhost/mcp",
      } as MCPServerConfig),
    ).toEqual({ type: "streamable-http", detail: "http://localhost/mcp" });
    expect(
      summarizeServerConfig({
        type: "streamable-http",
      } as MCPServerConfig),
    ).toEqual({ type: "streamable-http", detail: "" });
  });
});

describe("annotateServerEntriesWithSessions", () => {
  const entries = [
    { name: "a", type: "stdio", detail: "node a" },
    { name: "b", type: "stdio", detail: "node b" },
  ];

  it("returns entries unchanged when there are no sessions", () => {
    expect(annotateServerEntriesWithSessions(entries, [])).toBe(entries);
  });

  it("marks matching entry names and MRU", () => {
    expect(
      annotateServerEntriesWithSessions(entries, [
        { name: "b", isMru: true },
        { name: "other" },
      ]),
    ).toEqual([
      { name: "a", type: "stdio", detail: "node a" },
      { name: "b", type: "stdio", detail: "node b", session: "b", isMru: true },
    ]);
  });

  it("omits isMru when the session is not MRU", () => {
    expect(
      annotateServerEntriesWithSessions(entries, [{ name: "a", isMru: false }]),
    ).toEqual([
      { name: "a", type: "stdio", detail: "node a", session: "a" },
      { name: "b", type: "stdio", detail: "node b" },
    ]);
  });
});

describe("listServerEntries / --method servers/list", () => {
  let configPath: string | undefined;

  afterEach(() => {
    if (configPath) {
      deleteConfigFile(configPath);
      configPath = undefined;
    }
  });

  it("lists catalog entries without connecting", async () => {
    configPath = createSampleTestConfig();
    const entries = await listServerEntries({ configPath });
    expect(entries.map((e) => e.name).sort()).toEqual([
      "test-http",
      "test-stdio",
    ]);
    expect(entries.find((e) => e.name === "test-stdio")?.type).toBe("stdio");
  });

  it("works via one-shot --method servers/list", async () => {
    configPath = createSampleTestConfig();
    const result = await runCli([
      "--config",
      configPath,
      "--method",
      "servers/list",
      "--format",
      "json",
    ]);
    expectCliSuccess(result);
    const body = JSON.parse(result.stdout) as {
      result: { servers: { name: string }[] };
    };
    expect(body.result.servers.map((s) => s.name).sort()).toEqual([
      "test-http",
      "test-stdio",
    ]);
  });
});

describe("showServerEntry / servers/show", () => {
  let configPath: string | undefined;

  afterEach(() => {
    if (configPath) {
      deleteConfigFile(configPath);
      configPath = undefined;
    }
  });

  it("redacts env values and sensitive settings fields", () => {
    expect(
      sanitizeServerConfig({
        type: "stdio",
        command: "node",
        env: { SECRET: "value", HELLO: "world" },
      }),
    ).toEqual({
      type: "stdio",
      command: "node",
      env: { SECRET: "[redacted]", HELLO: "[redacted]" },
    });

    const settings: InspectorServerSettings = {
      headers: [
        { key: "Authorization", value: "Bearer x" },
        { key: "X-Custom", value: "ok" },
      ],
      metadata: [],
      env: [{ key: "TOKEN", value: "secret" }],
      connectionTimeout: 0,
      requestTimeout: 0,
      taskTtl: 60_000,
      maxFetchRequests: 100,
      roots: [],
      oauthClientSecret: "shh",
      oauthClientId: "cid",
    };
    const sanitized = sanitizeServerSettings(settings);
    expect(sanitized.oauthClientSecret).toBe("[redacted]");
    expect(sanitized.oauthClientId).toBe("cid");
    expect(sanitized.headers).toEqual([
      { key: "Authorization", value: "[redacted]" },
      { key: "X-Custom", value: "ok" },
    ]);
    expect(sanitized.env).toEqual([{ key: "TOKEN", value: "[redacted]" }]);
  });

  it("shows one resolved entry without connecting", async () => {
    configPath = createSampleTestConfig();
    const entry = await showServerEntry("test-stdio", { configPath });
    expect(entry.name).toBe("test-stdio");
    expect(entry.type).toBe("stdio");
    expect(entry.config).toMatchObject({
      type: "stdio",
      command: expect.any(String),
    });
    expect(entry.config.env).toEqual({ HELLO: "[redacted]" });
  });

  it("works via session mcpi servers/show", async () => {
    configPath = createSampleTestConfig();
    const result = await runMcp([
      "servers/show",
      "test-stdio",
      "--config",
      configPath,
      "--format",
      "json",
    ]);
    expectCliSuccess(result);
    const body = JSON.parse(result.stdout) as {
      name: string;
      config: { env?: Record<string, string> };
    };
    expect(body.name).toBe("test-stdio");
    expect(body.config.env?.HELLO).toBe("[redacted]");
  });

  it("works via one-shot --method servers/show --server", async () => {
    configPath = createSampleTestConfig();
    const result = await runCli([
      "--config",
      configPath,
      "--method",
      "servers/show",
      "--server",
      "test-http",
      "--format",
      "json",
    ]);
    expectCliSuccess(result);
    const body = JSON.parse(result.stdout) as {
      result: { name: string; type: string };
    };
    expect(body.result.name).toBe("test-http");
    expect(body.result.type).toBe("streamable-http");
  });

  it("rejects one-shot servers/show without --server", async () => {
    configPath = createSampleTestConfig();
    const result = await runCli([
      "--config",
      configPath,
      "--method",
      "servers/show",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toMatch(/--server/);
  });

  it("rejects unknown server names", async () => {
    configPath = createSampleTestConfig();
    await expect(showServerEntry("nope", { configPath })).rejects.toThrow(
      /not found/,
    );
  });
});
