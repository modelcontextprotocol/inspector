import { describe, expect, it } from "vitest";
import {
  isTasksExtensionNegotiated,
  taskSessionEndpointId,
} from "@inspector/core/extension/tasks/session.js";
import { TASKS_EXTENSION_KEY } from "@inspector/core/extension/tasks/constants.js";

const clientInfo = { name: "inspector", version: "1.0.0" };

describe("taskSessionEndpointId", () => {
  it("is stable for one target and differs across targets", async () => {
    const http = { type: "streamable-http" as const, url: "http://h/mcp" };
    const a = await taskSessionEndpointId(http, clientInfo);
    expect(await taskSessionEndpointId(http, clientInfo)).toBe(a);
    expect(
      await taskSessionEndpointId(
        { type: "sse", url: "http://h/mcp" },
        clientInfo,
      ),
    ).not.toBe(a);
  });

  it("covers stdio targets, with and without a cwd", async () => {
    const stdio = { type: "stdio" as const, command: "node", args: ["s.js"] };
    const bare = await taskSessionEndpointId(stdio, clientInfo);
    const withCwd = await taskSessionEndpointId(
      { ...stdio, cwd: "/tmp" },
      clientInfo,
    );
    expect(bare).not.toBe(withCwd);
  });
});

describe("isTasksExtensionNegotiated", () => {
  const caps = { extensions: { [TASKS_EXTENSION_KEY]: {} } };

  it("needs both the modern era and the advertised extension", () => {
    expect(isTasksExtensionNegotiated("modern", caps)).toBe(true);
    expect(isTasksExtensionNegotiated("legacy", caps)).toBe(false);
    expect(isTasksExtensionNegotiated("modern", {})).toBe(false);
    expect(isTasksExtensionNegotiated(undefined, undefined)).toBe(false);
  });
});
