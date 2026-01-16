import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliSuccess,
  expectCliFailure,
  expectValidJson,
  expectJsonError,
} from "./helpers/assertions.js";
import { getTestMcpServerCommand } from "./helpers/test-server-stdio.js";

describe("Tool Tests", () => {
  describe("Tool Discovery", () => {
    it("should list available tools", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("tools");
      expect(Array.isArray(json.tools)).toBe(true);
      expect(json.tools.length).toBeGreaterThan(0);
      // Validate that tools have required properties
      expect(json.tools[0]).toHaveProperty("name");
      expect(json.tools[0]).toHaveProperty("description");
      // Validate expected tools from test-mcp-server
      const toolNames = json.tools.map((tool: any) => tool.name);
      expect(toolNames).toContain("echo");
      expect(toolNames).toContain("get-sum");
      expect(toolNames).toContain("get-annotated-message");
    });
  });

  describe("JSON Argument Parsing", () => {
    it("should handle string arguments (backward compatibility)", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=hello world",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      expect(json.content.length).toBeGreaterThan(0);
      expect(json.content[0]).toHaveProperty("type", "text");
      expect(json.content[0].text).toBe("Echo: hello world");
    });

    it("should handle integer number arguments", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "get-sum",
        "--tool-arg",
        "a=42",
        "b=58",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      expect(json.content.length).toBeGreaterThan(0);
      expect(json.content[0]).toHaveProperty("type", "text");
      // test-mcp-server returns JSON with {result: a+b}
      const resultData = JSON.parse(json.content[0].text);
      expect(resultData.result).toBe(100);
    });

    it("should handle decimal number arguments", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "get-sum",
        "--tool-arg",
        "a=19.99",
        "b=20.01",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      expect(json.content.length).toBeGreaterThan(0);
      expect(json.content[0]).toHaveProperty("type", "text");
      // test-mcp-server returns JSON with {result: a+b}
      const resultData = JSON.parse(json.content[0].text);
      expect(resultData.result).toBeCloseTo(40.0, 2);
    });

    it("should handle boolean arguments - true", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "get-annotated-message",
        "--tool-arg",
        "messageType=success",
        "includeImage=true",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      // Should have both text and image content
      expect(json.content.length).toBeGreaterThan(1);
      const hasImage = json.content.some((item: any) => item.type === "image");
      expect(hasImage).toBe(true);
    });

    it("should handle boolean arguments - false", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "get-annotated-message",
        "--tool-arg",
        "messageType=error",
        "includeImage=false",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      // Should only have text content, no image
      const hasImage = json.content.some((item: any) => item.type === "image");
      expect(hasImage).toBe(false);
      // test-mcp-server returns "This is a {messageType} message"
      expect(json.content[0].text.toLowerCase()).toContain("error");
    });

    it("should handle null arguments", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        'message="null"',
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      expect(json.content[0]).toHaveProperty("type", "text");
      // The string "null" should be passed through
      expect(json.content[0].text).toBe("Echo: null");
    });

    it("should handle multiple arguments with mixed types", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "get-sum",
        "--tool-arg",
        "a=42.5",
        "b=57.5",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      expect(json.content.length).toBeGreaterThan(0);
      expect(json.content[0]).toHaveProperty("type", "text");
      // test-mcp-server returns JSON with {result: a+b}
      const resultData = JSON.parse(json.content[0].text);
      expect(resultData.result).toBeCloseTo(100.0, 1);
    });
  });

  describe("JSON Parsing Edge Cases", () => {
    it("should fall back to string for invalid JSON", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message={invalid json}",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      expect(json.content[0]).toHaveProperty("type", "text");
      // Should treat invalid JSON as a string
      expect(json.content[0].text).toBe("Echo: {invalid json}");
    });

    it("should handle empty string value", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        'message=""',
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      expect(json.content[0]).toHaveProperty("type", "text");
      // Empty string should be preserved
      expect(json.content[0].text).toBe("Echo: ");
    });

    it("should handle special characters in strings", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        'message="C:\\\\Users\\\\test"',
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      expect(json.content[0]).toHaveProperty("type", "text");
      // Special characters should be preserved
      expect(json.content[0].text).toContain("C:");
      expect(json.content[0].text).toContain("Users");
      expect(json.content[0].text).toContain("test");
    });

    it("should handle unicode characters", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        'message="🚀🎉✨"',
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      expect(json.content[0]).toHaveProperty("type", "text");
      // Unicode characters should be preserved
      expect(json.content[0].text).toContain("🚀");
      expect(json.content[0].text).toContain("🎉");
      expect(json.content[0].text).toContain("✨");
    });

    it("should handle arguments with equals signs in values", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=2+2=4",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      expect(json.content[0]).toHaveProperty("type", "text");
      // Equals signs in values should be preserved
      expect(json.content[0].text).toBe("Echo: 2+2=4");
    });

    it("should handle base64-like strings", async () => {
      const { command, args } = getTestMcpServerCommand();
      const base64String =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0=";
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        `message=${base64String}`,
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      expect(json.content[0]).toHaveProperty("type", "text");
      // Base64-like strings should be preserved
      expect(json.content[0].text).toBe(`Echo: ${base64String}`);
    });
  });

  describe("Tool Error Handling", () => {
    it("should fail with nonexistent tool", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "nonexistent_tool",
        "--tool-arg",
        "message=test",
      ]);

      // CLI returns exit code 0 but includes isError: true in JSON
      expectJsonError(result);
    });

    it("should fail when tool name is missing", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-arg",
        "message=test",
      ]);

      expectCliFailure(result);
    });

    it("should fail with invalid tool argument format", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "invalid_format_no_equals",
      ]);

      expectCliFailure(result);
    });
  });

  describe("Prompt JSON Arguments", () => {
    it("should handle prompt with JSON arguments", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "prompts/get",
        "--prompt-name",
        "args-prompt",
        "--prompt-args",
        "city=New York",
        "state=NY",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("messages");
      expect(Array.isArray(json.messages)).toBe(true);
      expect(json.messages.length).toBeGreaterThan(0);
      expect(json.messages[0]).toHaveProperty("content");
      expect(json.messages[0].content).toHaveProperty("type", "text");
      // Validate that the arguments were actually used in the response
      // test-mcp-server formats it as "This is a prompt with arguments: city={city}, state={state}"
      expect(json.messages[0].content.text).toContain("city=New York");
      expect(json.messages[0].content.text).toContain("state=NY");
    });

    it("should handle prompt with simple arguments", async () => {
      // Note: simple-prompt doesn't accept arguments, but the CLI should still
      // accept the command and the server should ignore the arguments
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "prompts/get",
        "--prompt-name",
        "simple-prompt",
        "--prompt-args",
        "name=test",
        "count=5",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("messages");
      expect(Array.isArray(json.messages)).toBe(true);
      expect(json.messages.length).toBeGreaterThan(0);
      expect(json.messages[0]).toHaveProperty("content");
      expect(json.messages[0].content).toHaveProperty("type", "text");
      // test-mcp-server's simple-prompt returns standard message (ignoring args)
      expect(json.messages[0].content.text).toBe(
        "This is a simple prompt for testing purposes.",
      );
    });
  });

  describe("Backward Compatibility", () => {
    it("should support existing string-only usage", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=hello",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      expect(json.content[0]).toHaveProperty("type", "text");
      expect(json.content[0].text).toBe("Echo: hello");
    });

    it("should support multiple string arguments", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "get-sum",
        "--tool-arg",
        "a=10",
        "b=20",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("content");
      expect(Array.isArray(json.content)).toBe(true);
      expect(json.content.length).toBeGreaterThan(0);
      expect(json.content[0]).toHaveProperty("type", "text");
      // test-mcp-server returns JSON with {result: a+b}
      const resultData = JSON.parse(json.content[0].text);
      expect(resultData.result).toBe(30);
    });
  });
});
