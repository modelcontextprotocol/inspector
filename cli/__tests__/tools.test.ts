import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliSuccess,
  expectCliFailure,
  expectValidJson,
  expectJsonError,
} from "./helpers/assertions.js";
import { TEST_SERVER } from "./helpers/fixtures.js";

const TEST_CMD = "npx";
const TEST_ARGS = [TEST_SERVER];

describe("Tool Tests", () => {
  describe("Tool Discovery", () => {
    it("should list available tools", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("tools");
    });
  });

  describe("JSON Argument Parsing", () => {
    it("should handle string arguments (backward compatibility)", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=hello world",
      ]);

      expectCliSuccess(result);
    });

    it("should handle integer number arguments", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
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
    });

    it("should handle decimal number arguments", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
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
    });

    it("should handle boolean arguments - true", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
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
    });

    it("should handle boolean arguments - false", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
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
    });

    it("should handle null arguments", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        'message="null"',
      ]);

      expectCliSuccess(result);
    });

    it("should handle multiple arguments with mixed types", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
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
    });
  });

  describe("JSON Parsing Edge Cases", () => {
    it("should fall back to string for invalid JSON", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message={invalid json}",
      ]);

      expectCliSuccess(result);
    });

    it("should handle empty string value", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        'message=""',
      ]);

      expectCliSuccess(result);
    });

    it("should handle special characters in strings", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        'message="C:\\\\Users\\\\test"',
      ]);

      expectCliSuccess(result);
    });

    it("should handle unicode characters", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        'message="🚀🎉✨"',
      ]);

      expectCliSuccess(result);
    });

    it("should handle arguments with equals signs in values", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=2+2=4",
      ]);

      expectCliSuccess(result);
    });

    it("should handle base64-like strings", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0=",
      ]);

      expectCliSuccess(result);
    });
  });

  describe("Tool Error Handling", () => {
    it("should fail with nonexistent tool", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
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
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-arg",
        "message=test",
      ]);

      expectCliFailure(result);
    });

    it("should fail with invalid tool argument format", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
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
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
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
    });

    it("should handle prompt with simple arguments", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
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
    });
  });

  describe("Backward Compatibility", () => {
    it("should support existing string-only usage", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=hello",
      ]);

      expectCliSuccess(result);
    });

    it("should support multiple string arguments", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
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
    });
  });
});
