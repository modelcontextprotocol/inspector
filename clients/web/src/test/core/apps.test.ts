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

  describe("resource-content URI matching", () => {
    const csp = { connectDomains: ["https://api.example.com"] };

    function resourceAt(
      uris: string[],
      uiOn: number | "result" = 0,
    ): ReadResourceResult {
      return {
        contents: uris.map((uri, i) => ({
          uri,
          mimeType: "text/html",
          text: "<html></html>",
          ...(uiOn === i ? { _meta: { ui: { csp } } } : {}),
        })),
        ...(uiOn === "result" ? { _meta: { ui: { csp } } } : {}),
      };
    }

    it("finds the content block on exact URI match", () => {
      expect(extractAppInfo(APP_TOOL, resourceAt([NESTED_URI])).csp).toEqual(
        csp,
      );
    });

    it("finds the content block when the server's URI differs only by case or trailing slash", () => {
      const tool = toolWith({
        ui: { resourceUri: "ui://Demo/Widget", visibility: ["app"] },
      });
      // Two blocks so the single-block fallback can't paper over a failed
      // normalize — the match must be on the normalized URI.
      const info = extractAppInfo(
        tool,
        resourceAt(["ui://other/x", "ui://demo/widget/"], 1),
      );
      expect(info.csp).toEqual(csp);
      expect(info.resourceMimeType).toBe("text/html");
    });

    it("falls back to the sole content block when the URI does not match — resources/read returns the requested resource by definition", () => {
      const info = extractAppInfo(
        APP_TOOL,
        resourceAt(["ui://demo/widget?v=2"]),
      );
      expect(info.csp).toEqual(csp);
    });

    it("does not pick an arbitrary block when multiple non-matching blocks are returned", () => {
      const info = extractAppInfo(
        APP_TOOL,
        resourceAt(["ui://other/a", "ui://other/b"], "result"),
      );
      // No content match → no resourceMimeType from a content block …
      expect(info.resourceMimeType).toBeUndefined();
      // … but the result-level _meta.ui still flows through.
      expect(info.csp).toEqual(csp);
    });

    it("normalize is just lowercase + trailing-slash strip; an empty URI does not match", () => {
      const result: ReadResourceResult = {
        contents: [
          { uri: "", text: "x", _meta: { ui: { csp } } },
          { uri: "ui://other", text: "y" },
        ],
      };
      const info = extractAppInfo(APP_TOOL, result);
      expect(info.csp).toBeUndefined();
    });
  });
});
