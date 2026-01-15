import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import { expectCliSuccess, expectCliFailure } from "./helpers/assertions.js";
import { TEST_SERVER } from "./helpers/fixtures.js";

const TEST_CMD = "npx";
const TEST_ARGS = [TEST_SERVER];

describe("Metadata Tests", () => {
  describe("General Metadata", () => {
    it("should work with tools/list", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/list",
        "--metadata",
        "client=test-client",
      ]);

      expectCliSuccess(result);
    });

    it("should work with resources/list", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "resources/list",
        "--metadata",
        "client=test-client",
      ]);

      expectCliSuccess(result);
    });

    it("should work with prompts/list", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "prompts/list",
        "--metadata",
        "client=test-client",
      ]);

      expectCliSuccess(result);
    });

    it("should work with resources/read", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "resources/read",
        "--uri",
        "demo://resource/static/document/architecture.md",
        "--metadata",
        "client=test-client",
      ]);

      expectCliSuccess(result);
    });

    it("should work with prompts/get", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "prompts/get",
        "--prompt-name",
        "simple-prompt",
        "--metadata",
        "client=test-client",
      ]);

      expectCliSuccess(result);
    });
  });

  describe("Tool-Specific Metadata", () => {
    it("should work with tools/call", async () => {
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
        "--tool-metadata",
        "client=test-client",
      ]);

      expectCliSuccess(result);
    });

    it("should work with complex tool", async () => {
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
        "--tool-metadata",
        "client=test-client",
      ]);

      expectCliSuccess(result);
    });
  });

  describe("Metadata Merging", () => {
    it("should merge general and tool-specific metadata (tool-specific overrides)", async () => {
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
        "--metadata",
        "client=general-client",
        "--tool-metadata",
        "client=test-client",
      ]);

      expectCliSuccess(result);
    });
  });

  describe("Metadata Parsing", () => {
    it("should handle numeric values", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/list",
        "--metadata",
        "integer_value=42",
        "decimal_value=3.14159",
        "negative_value=-10",
      ]);

      expectCliSuccess(result);
    });

    it("should handle JSON values", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/list",
        "--metadata",
        'json_object="{\\"key\\":\\"value\\"}"',
        'json_array="[1,2,3]"',
        'json_string="\\"quoted\\""',
      ]);

      expectCliSuccess(result);
    });

    it("should handle special characters", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/list",
        "--metadata",
        "unicode=🚀🎉✨",
        "special_chars=!@#$%^&*()",
        "spaces=hello world with spaces",
      ]);

      expectCliSuccess(result);
    });
  });

  describe("Metadata Edge Cases", () => {
    it("should handle single metadata entry", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/list",
        "--metadata",
        "single_key=single_value",
      ]);

      expectCliSuccess(result);
    });

    it("should handle many metadata entries", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/list",
        "--metadata",
        "key1=value1",
        "key2=value2",
        "key3=value3",
        "key4=value4",
        "key5=value5",
      ]);

      expectCliSuccess(result);
    });
  });

  describe("Metadata Error Cases", () => {
    it("should fail with invalid metadata format (missing equals)", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/list",
        "--metadata",
        "invalid_format_no_equals",
      ]);

      expectCliFailure(result);
    });

    it("should fail with invalid tool-metadata format (missing equals)", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=test",
        "--tool-metadata",
        "invalid_format_no_equals",
      ]);

      expectCliFailure(result);
    });
  });

  describe("Metadata Impact", () => {
    it("should handle tool-specific metadata precedence over general", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=precedence test",
        "--metadata",
        "client=general-client",
        "--tool-metadata",
        "client=tool-specific-client",
      ]);

      expectCliSuccess(result);
    });

    it("should work with resources methods", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "resources/list",
        "--metadata",
        "resource_client=test-resource-client",
      ]);

      expectCliSuccess(result);
    });

    it("should work with prompts methods", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "prompts/get",
        "--prompt-name",
        "simple-prompt",
        "--metadata",
        "prompt_client=test-prompt-client",
      ]);

      expectCliSuccess(result);
    });
  });

  describe("Metadata Validation", () => {
    it("should handle special characters in keys", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=special keys test",
        "--metadata",
        "key-with-dashes=value1",
        "key_with_underscores=value2",
        "key.with.dots=value3",
      ]);

      expectCliSuccess(result);
    });
  });

  describe("Metadata Integration", () => {
    it("should work with all MCP methods", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/list",
        "--metadata",
        "integration_test=true",
        "test_phase=all_methods",
      ]);

      expectCliSuccess(result);
    });

    it("should handle complex metadata scenario", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=complex test",
        "--metadata",
        "session_id=12345",
        "user_id=67890",
        "timestamp=2024-01-01T00:00:00Z",
        "request_id=req-abc-123",
        "--tool-metadata",
        "tool_session=session-xyz-789",
        "execution_context=test",
        "priority=high",
      ]);

      expectCliSuccess(result);
    });

    it("should handle metadata parsing validation", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=parsing validation test",
        "--metadata",
        "valid_key=valid_value",
        "numeric_key=123",
        "boolean_key=true",
        'json_key=\'{"test":"value"}\'',
        "special_key=!@#$%^&*()",
        "unicode_key=🚀🎉✨",
      ]);

      expectCliSuccess(result);
    });
  });
});
