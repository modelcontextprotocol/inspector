import { describe, it, expect } from "vitest";
import {
  ErrorCode,
  McpError,
  UrlElicitationRequiredError,
} from "@modelcontextprotocol/sdk/types.js";
import type { ElicitRequestURLParams } from "@modelcontextprotocol/sdk/types.js";
import { getUrlElicitationsFromError } from "@inspector/core/mcp/urlElicitation.js";

const elicitation: ElicitRequestURLParams = {
  mode: "url",
  url: "https://example.com/authorize",
  message: "Authorize to continue.",
  elicitationId: "elicit-1",
};

describe("getUrlElicitationsFromError", () => {
  it("returns the elicitations from a typed UrlElicitationRequiredError", () => {
    const error = new UrlElicitationRequiredError([elicitation]);
    expect(getUrlElicitationsFromError(error)).toEqual([elicitation]);
  });

  it("returns the elicitations from a generic McpError carrying the -32042 data", () => {
    const error = new McpError(
      ErrorCode.UrlElicitationRequired,
      "This request requires browser-based authorization.",
      { elicitations: [elicitation] },
    );
    expect(getUrlElicitationsFromError(error)).toEqual([elicitation]);
  });

  it("returns an empty array for a -32042 McpError with no elicitations (non-spec)", () => {
    const error = new McpError(
      ErrorCode.UrlElicitationRequired,
      "This request requires browser-based authorization.",
    );
    expect(getUrlElicitationsFromError(error)).toEqual([]);
  });

  it("returns null for a non -32042 McpError", () => {
    const error = new McpError(ErrorCode.InvalidParams, "bad params");
    expect(getUrlElicitationsFromError(error)).toBeNull();
  });

  it("returns null for a plain Error", () => {
    expect(getUrlElicitationsFromError(new Error("boom"))).toBeNull();
  });

  it("returns null for non-error values", () => {
    expect(getUrlElicitationsFromError("nope")).toBeNull();
    expect(getUrlElicitationsFromError(undefined)).toBeNull();
  });
});
