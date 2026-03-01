import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveSandboxPort,
  createSandboxController,
} from "./sandbox-controller.js";

describe("resolveSandboxPort", () => {
  let origMCP: string | undefined;
  let origServer: string | undefined;

  beforeEach(() => {
    origMCP = process.env.MCP_SANDBOX_PORT;
    origServer = process.env.SERVER_PORT;
    delete process.env.MCP_SANDBOX_PORT;
    delete process.env.SERVER_PORT;
  });

  afterEach(() => {
    if (origMCP !== undefined) process.env.MCP_SANDBOX_PORT = origMCP;
    else delete process.env.MCP_SANDBOX_PORT;
    if (origServer !== undefined) process.env.SERVER_PORT = origServer;
    else delete process.env.SERVER_PORT;
  });

  it("returns MCP_SANDBOX_PORT when set and valid", () => {
    process.env.MCP_SANDBOX_PORT = "9123";
    expect(resolveSandboxPort()).toBe(9123);
  });

  it("falls back to SERVER_PORT when MCP_SANDBOX_PORT is unset", () => {
    process.env.SERVER_PORT = "6277";
    expect(resolveSandboxPort()).toBe(6277);
  });

  it("falls back to SERVER_PORT when MCP_SANDBOX_PORT is empty string", () => {
    process.env.MCP_SANDBOX_PORT = "";
    process.env.SERVER_PORT = "5000";
    expect(resolveSandboxPort()).toBe(5000);
  });

  it("returns 0 (dynamic) when neither is set", () => {
    expect(resolveSandboxPort()).toBe(0);
  });

  it("returns 0 when MCP_SANDBOX_PORT is invalid and SERVER_PORT unset", () => {
    process.env.MCP_SANDBOX_PORT = "not-a-number";
    expect(resolveSandboxPort()).toBe(0);
  });

  it("prefers MCP_SANDBOX_PORT over SERVER_PORT when both set", () => {
    process.env.MCP_SANDBOX_PORT = "1111";
    process.env.SERVER_PORT = "2222";
    expect(resolveSandboxPort()).toBe(1111);
  });
});

describe("createSandboxController", () => {
  const minimalHtml = "<!DOCTYPE html><html><body>ok</body></html>";

  it("start() returns port and url, getUrl() returns URL until close", async () => {
    const controller = createSandboxController({
      port: 0,
      sandboxHtml: minimalHtml,
      host: "127.0.0.1",
    });
    const { port, url } = await controller.start();
    expect(port).toBeGreaterThan(0);
    expect(url).toBe(`http://127.0.0.1:${port}/sandbox`);
    expect(controller.getUrl()).toBe(url);
    await controller.close();
    expect(controller.getUrl()).toBeNull();
  });

  it("with port 0 (dynamic): start() uses OS-assigned port", async () => {
    const controller = createSandboxController({
      port: 0,
      sandboxHtml: minimalHtml,
    });
    const { port, url } = await controller.start();
    expect(port).toBeGreaterThan(0);
    expect(url).toMatch(/^http:\/\/localhost:\d+\/sandbox$/);
    await controller.close();
  });

  it("close() is idempotent", async () => {
    const controller = createSandboxController({
      port: 0,
      sandboxHtml: minimalHtml,
    });
    await controller.start();
    await controller.close();
    await controller.close();
  });
});
