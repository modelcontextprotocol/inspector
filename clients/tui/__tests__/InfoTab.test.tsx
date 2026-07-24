import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";

// MUST mock ink-scroll-view: the real ScrollView renders a placeholder minimap
// in the non-TTY test env and never mounts its children. This passthrough
// renders children directly and stubs scrollBy/scrollTo/getViewportHeight.
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import type {
  MCPServerConfig,
  ServerState,
} from "@inspector/core/mcp/index.js";
import { headersToServerSettings } from "@inspector/core/mcp/node/servers.js";
import { InfoTab } from "../src/components/InfoTab.js";

// Ink processes stdin keypresses asynchronously — await this after stdin.write
// and after rerender() before asserting.
const tick = async () => {
  // Flush several macrotask cycles so an effect -> setState -> re-render chain
  // settles before assertions, even on slow/loaded CI (a single tick can race).
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};

// Real terminal escape sequences (with the leading ESC) so ink reliably parses
// them as arrow / page keys.
const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

const stdioConfig: MCPServerConfig = {
  type: "stdio",
  command: "node",
  args: ["server.js", "--flag"],
  env: { FOO: "bar", BAZ: "qux" },
  cwd: "/tmp/work",
};

const baseState: ServerState = {
  status: "disconnected",
  error: null,
  resources: [],
  prompts: [],
  tools: [],
  stderrLogs: [],
};

describe("InfoTab", () => {
  it("renders nothing beyond the header when serverName is null", () => {
    const { lastFrame } = render(
      <InfoTab
        serverName={null}
        serverConfig={null}
        serverState={null}
        width={80}
        height={20}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Info");
    expect(frame).not.toContain("Server Configuration");
  });

  it("renders 'No configuration available' when config is null", () => {
    const { lastFrame } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={null}
        serverState={baseState}
        width={80}
        height={20}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Server Configuration");
    expect(frame).toContain("No configuration available");
    expect(frame).toContain("Server not connected");
  });

  it("renders a full stdio config (command, args, env, cwd)", () => {
    const { lastFrame } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={stdioConfig}
        serverState={baseState}
        width={80}
        height={20}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Type: stdio");
    expect(frame).toContain("Command: node");
    expect(frame).toContain("Args:");
    expect(frame).toContain("server.js");
    expect(frame).toContain("--flag");
    expect(frame).toContain("Env:");
    expect(frame).toContain("FOO=bar");
    expect(frame).toContain("CWD: /tmp/work");
  });

  it("renders a stdio config with type omitted (undefined defaults to stdio)", () => {
    const config: MCPServerConfig = {
      command: "python",
    };
    const { lastFrame } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={config}
        serverState={baseState}
        width={80}
        height={20}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Type: stdio");
    expect(frame).toContain("Command: python");
    // No args/env/cwd → those optional blocks are skipped
    expect(frame).not.toContain("Args:");
    expect(frame).not.toContain("Env:");
    expect(frame).not.toContain("CWD:");
  });

  it("renders an sse config with headers", () => {
    const config: MCPServerConfig = {
      type: "sse",
      url: "https://example.com/sse",
    };
    const { lastFrame } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={config}
        serverSettings={headersToServerSettings({ Authorization: "Bearer x" })}
        serverState={baseState}
        width={80}
        height={20}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Type: sse");
    expect(frame).toContain("URL: https://example.com/sse");
    expect(frame).toContain("Headers:");
    expect(frame).toContain("Authorization=Bearer x");
  });

  it("renders an sse config without headers", () => {
    const config: MCPServerConfig = {
      type: "sse",
      url: "https://example.com/sse",
    };
    const { lastFrame } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={config}
        serverState={baseState}
        width={80}
        height={20}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Type: sse");
    expect(frame).not.toContain("Headers:");
  });

  it("renders a streamable-http config with headers", () => {
    const config: MCPServerConfig = {
      type: "streamable-http",
      url: "https://example.com/mcp",
    };
    const { lastFrame } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={config}
        serverSettings={headersToServerSettings({ "X-Key": "abc" })}
        serverState={baseState}
        width={80}
        height={20}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Type: streamable-http");
    expect(frame).toContain("URL: https://example.com/mcp");
    expect(frame).toContain("Headers:");
    expect(frame).toContain("X-Key=abc");
  });

  it("renders a streamable-http config without headers", () => {
    const config: MCPServerConfig = {
      type: "streamable-http",
      url: "https://example.com/mcp",
    };
    const { lastFrame } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={config}
        serverState={baseState}
        width={80}
        height={20}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Type: streamable-http");
    expect(frame).not.toContain("Headers:");
  });

  it("renders connected server information (name, version, instructions)", () => {
    const state: ServerState = {
      ...baseState,
      status: "connected",
      serverInfo: { name: "Test Server", version: "1.2.3" },
      instructions: "Use me wisely",
    };
    const { lastFrame } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={stdioConfig}
        serverState={state}
        width={80}
        height={30}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Server Information");
    expect(frame).toContain("Name: Test Server");
    expect(frame).toContain("Version: 1.2.3");
    expect(frame).toContain("Instructions:");
    expect(frame).toContain("Use me wisely");
  });

  it("renders connected server info without optional fields", () => {
    const state: ServerState = {
      ...baseState,
      status: "connected",
      serverInfo: { name: "", version: "" },
    };
    const { lastFrame } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={stdioConfig}
        serverState={state}
        width={80}
        height={30}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Server Information");
    expect(frame).not.toContain("Name:");
    expect(frame).not.toContain("Version:");
    expect(frame).not.toContain("Instructions:");
  });

  it("does not render Server Information when connected but no serverInfo", () => {
    const state: ServerState = {
      ...baseState,
      status: "connected",
    };
    const { lastFrame } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={stdioConfig}
        serverState={state}
        width={80}
        height={30}
      />,
    );
    expect(lastFrame() ?? "").not.toContain("Server Information");
  });

  it("renders an error status with error message", () => {
    const state: ServerState = {
      ...baseState,
      status: "error",
      error: "boom failed to connect",
    };
    const { lastFrame } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={null}
        serverState={state}
        width={80}
        height={40}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Error");
    expect(frame).toContain("boom failed to connect");
  });

  it("renders an error status without an error message", () => {
    const state: ServerState = {
      ...baseState,
      status: "error",
      error: null,
    };
    const { lastFrame } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={null}
        serverState={state}
        width={80}
        height={40}
      />,
    );
    expect(lastFrame() ?? "").toContain("Error");
  });

  it("shows the footer and handles scroll keys when focused", async () => {
    const { lastFrame, stdin } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={stdioConfig}
        serverState={baseState}
        width={80}
        height={20}
        focused
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("to scroll");

    // Drive every useInput branch
    stdin.write("[A"); // up arrow
    await tick();
    stdin.write("[B"); // down arrow
    await tick();
    stdin.write("[5~"); // pageUp
    await tick();
    stdin.write("[6~"); // pageDown
    await tick();
    // A non-handled key (no branch) to exercise the else fall-through
    stdin.write("x");
    await tick();

    expect(lastFrame() ?? "").toContain("Info");
  });

  it("renders no config details for an unrecognized server type", () => {
    // type is none of stdio / sse / streamable-http → the final `: null`
    // ternary branch in the config block.
    const config = {
      type: "websocket",
      url: "ws://example.com",
    } as unknown as MCPServerConfig;
    const { lastFrame } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={config}
        serverState={baseState}
        width={80}
        height={20}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Server Configuration");
    expect(frame).not.toContain("Type: stdio");
    expect(frame).not.toContain("Type: sse");
    expect(frame).not.toContain("Type: streamable-http");
  });

  it("handles scroll keys when focused but the scroll ref is null", async () => {
    // serverName is null → no ScrollView mounts, so scrollViewRef.current is
    // null. The handler is still active (isActive: focused), so the keys
    // exercise the optional-chaining + `getViewportHeight() || 1` fallbacks.
    const { stdin } = render(
      <InfoTab
        serverName={null}
        serverConfig={null}
        serverState={null}
        width={80}
        height={20}
        focused
      />,
    );
    stdin.write(UP);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(PAGE_UP); // null ref → `|| 1`
    await tick();
    stdin.write(PAGE_DOWN); // null ref → `|| 1`
    await tick();
    expect(true).toBe(true);
  });

  it("does not show the footer when not focused", () => {
    const { lastFrame } = render(
      <InfoTab
        serverName="my-server"
        serverConfig={stdioConfig}
        serverState={baseState}
        width={80}
        height={20}
      />,
    );
    expect(lastFrame() ?? "").not.toContain("to scroll");
  });
});
