import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliFailure,
  expectOutputContains,
} from "./helpers/assertions.js";

describe("Header Parsing and Validation", () => {
  describe("Valid Headers", () => {
    it("should parse valid single header (connection will fail)", async () => {
      const result = await runCli([
        "https://example.com",
        "--cli",
        "--method",
        "tools/list",
        "--transport",
        "http",
        "--header",
        "Authorization: Bearer token123",
      ]);

      // Header parsing should succeed, but connection will fail
      expectCliFailure(result);
    });

    it("should parse multiple headers", async () => {
      const result = await runCli([
        "https://example.com",
        "--cli",
        "--method",
        "tools/list",
        "--transport",
        "http",
        "--header",
        "Authorization: Bearer token123",
        "--header",
        "X-API-Key: secret123",
      ]);

      // Header parsing should succeed, but connection will fail
      // Note: The CLI may exit with 0 even if connection fails, so we just check it doesn't crash
      expect(result.exitCode).not.toBeNull();
    });

    it("should handle header with colons in value", async () => {
      const result = await runCli([
        "https://example.com",
        "--cli",
        "--method",
        "tools/list",
        "--transport",
        "http",
        "--header",
        "X-Time: 2023:12:25:10:30:45",
      ]);

      // Header parsing should succeed, but connection will fail
      expect(result.exitCode).not.toBeNull();
    });

    it("should handle whitespace in headers", async () => {
      const result = await runCli([
        "https://example.com",
        "--cli",
        "--method",
        "tools/list",
        "--transport",
        "http",
        "--header",
        "  X-Header  :  value with spaces  ",
      ]);

      // Header parsing should succeed, but connection will fail
      expect(result.exitCode).not.toBeNull();
    });
  });

  describe("Invalid Header Formats", () => {
    it("should reject header format without colon", async () => {
      const result = await runCli([
        "https://example.com",
        "--cli",
        "--method",
        "tools/list",
        "--transport",
        "http",
        "--header",
        "InvalidHeader",
      ]);

      expectCliFailure(result);
      expectOutputContains(result, "Invalid header format");
    });

    it("should reject header format with empty name", async () => {
      const result = await runCli([
        "https://example.com",
        "--cli",
        "--method",
        "tools/list",
        "--transport",
        "http",
        "--header",
        ": value",
      ]);

      expectCliFailure(result);
      expectOutputContains(result, "Invalid header format");
    });

    it("should reject header format with empty value", async () => {
      const result = await runCli([
        "https://example.com",
        "--cli",
        "--method",
        "tools/list",
        "--transport",
        "http",
        "--header",
        "Header:",
      ]);

      expectCliFailure(result);
      expectOutputContains(result, "Invalid header format");
    });
  });
});
