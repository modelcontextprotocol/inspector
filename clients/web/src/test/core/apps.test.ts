import { describe, it, expect } from "vitest";
import type {
  ReadResourceResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  extractAppInfo,
  getAppResourceUri,
  isAppTool,
} from "@inspector/core/mcp/apps.js";

const NESTED_URI = "ui://demo/widget";
const FLAT_URI = "ui://legacy/widget";

const toolWith = (meta: Record<string, unknown> | undefined): Tool =>
  ({
    name: "demo",
    inputSchema: { type: "object" },
    ...(meta === undefined ? {} : { _meta: meta }),
  }) as Tool;

describe("getAppResourceUri", () => {
  it("returns the URI from the nested _meta.ui.resourceUri format", () => {
    expect(
      getAppResourceUri(toolWith({ ui: { resourceUri: NESTED_URI } })),
    ).toBe(NESTED_URI);
  });

  it("returns the URI from the deprecated flat _meta['ui/resourceUri'] format", () => {
    expect(getAppResourceUri(toolWith({ "ui/resourceUri": FLAT_URI }))).toBe(
      FLAT_URI,
    );
  });

  it("prefers the nested format when both are present", () => {
    expect(
      getAppResourceUri(
        toolWith({
          ui: { resourceUri: NESTED_URI },
          "ui/resourceUri": FLAT_URI,
        }),
      ),
    ).toBe(NESTED_URI);
  });

  it("returns undefined when _meta is missing", () => {
    expect(getAppResourceUri(toolWith(undefined))).toBeUndefined();
  });

  it("returns undefined when _meta has no UI resource keys", () => {
    expect(getAppResourceUri(toolWith({ other: "value" }))).toBeUndefined();
  });

  it("returns undefined when _meta.ui exists without resourceUri", () => {
    expect(
      getAppResourceUri(toolWith({ ui: { visibility: ["model"] } })),
    ).toBeUndefined();
  });

  it("throws when the nested URI does not start with ui://", () => {
    expect(() =>
      getAppResourceUri(
        toolWith({ ui: { resourceUri: "https://example.com/app" } }),
      ),
    ).toThrow(/Invalid UI resource URI/);
  });

  it("throws when the flat URI does not start with ui://", () => {
    expect(() =>
      getAppResourceUri(toolWith({ "ui/resourceUri": "javascript:alert(1)" })),
    ).toThrow(/Invalid UI resource URI/);
  });
});

describe("isAppTool", () => {
  it("returns true for a tool with a valid nested URI", () => {
    expect(isAppTool(toolWith({ ui: { resourceUri: NESTED_URI } }))).toBe(true);
  });

  it("returns true for a tool with a valid flat URI", () => {
    expect(isAppTool(toolWith({ "ui/resourceUri": FLAT_URI }))).toBe(true);
  });

  it("returns false when _meta is missing", () => {
    expect(isAppTool(toolWith(undefined))).toBe(false);
  });

  it("returns false when _meta has no UI resource keys", () => {
    expect(isAppTool(toolWith({ other: "value" }))).toBe(false);
  });

  it("returns false when _meta.ui exists without resourceUri", () => {
    expect(isAppTool(toolWith({ ui: { visibility: ["model"] } }))).toBe(false);
  });

  it("propagates the underlying throw for an invalid URI", () => {
    expect(() =>
      isAppTool(toolWith({ ui: { resourceUri: "not-a-ui-uri" } })),
    ).toThrow(/Invalid UI resource URI/);
  });
});

describe("extractAppInfo", () => {
  const APP_TOOL = toolWith({
    ui: { resourceUri: NESTED_URI, visibility: ["model", "app"] },
  });

  const resourceWith = (
    ui: Record<string, unknown> | undefined,
  ): ReadResourceResult => ({
    contents: [
      {
        uri: NESTED_URI,
        mimeType: "text/html",
        text: "<html></html>",
        ...(ui ? { _meta: { ui } } : {}),
      },
    ],
  });

  it("returns hasApp:false for a non-App tool", () => {
    expect(extractAppInfo(toolWith(undefined))).toEqual({
      hasApp: false,
      toolName: "demo",
    });
  });

  it("returns tool-side info (resourceUri, visibility) when no resource is supplied", () => {
    expect(extractAppInfo(APP_TOOL)).toEqual({
      hasApp: true,
      toolName: "demo",
      resourceUri: NESTED_URI,
      visibility: ["model", "app"],
    });
  });

  it("merges resource-side csp/permissions/domain/prefersBorder/mimeType from the matched content item", () => {
    const csp = { connectDomains: ["https://api.example.com"] };
    const permissions = { clipboard: true };
    const info = extractAppInfo(
      APP_TOOL,
      resourceWith({ csp, permissions, domain: "abc.example.net" }),
    );
    expect(info).toEqual({
      hasApp: true,
      toolName: "demo",
      resourceUri: NESTED_URI,
      visibility: ["model", "app"],
      csp,
      permissions,
      domain: "abc.example.net",
      resourceMimeType: "text/html",
    });
  });

  it("falls back to result-level _meta.ui when no content item matches the URI", () => {
    const result: ReadResourceResult = {
      contents: [{ uri: "ui://other", text: "" }],
      _meta: { ui: { domain: "fallback.example.net" } },
    };
    expect(extractAppInfo(APP_TOOL, result).domain).toBe(
      "fallback.example.net",
    );
  });

  it("includes prefersBorder:false when explicitly set", () => {
    expect(
      extractAppInfo(APP_TOOL, resourceWith({ prefersBorder: false }))
        .prefersBorder,
    ).toBe(false);
  });

  it("propagates the underlying throw for a malformed resourceUri", () => {
    expect(() =>
      extractAppInfo(toolWith({ ui: { resourceUri: "https://x" } })),
    ).toThrow(/Invalid UI resource URI/);
  });
});
