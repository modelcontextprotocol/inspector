import { describe, it, expect } from "vitest";
import type {
  ClientCapabilities,
  ElicitRequest,
  ElicitResult,
  ServerCapabilities,
} from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import {
  getElicitationUiResourceUri,
  getUiClientCapability,
  getUiServerCapability,
  isFormElicitation,
  supportsAppElicitation,
  validateAppElicitResult,
} from "@inspector/core/mcp/appElicitation.js";
import {
  MCP_APP_MIME_TYPE,
  UI_EXTENSION_KEY,
} from "@inspector/core/mcp/extensions.js";

/** A client that satisfies all three client-side negotiation gates. */
function eligibleClient(): ClientCapabilities {
  return {
    elicitation: { form: {} },
    extensions: {
      [UI_EXTENSION_KEY]: {
        mimeTypes: [MCP_APP_MIME_TYPE],
        elicitation: {},
      },
    },
  };
}

/** A server that advertises the nested MCP Apps elicitation setting. */
function eligibleServer(): ServerCapabilities {
  return { extensions: { [UI_EXTENSION_KEY]: { elicitation: {} } } };
}

function formParams(
  extra: Partial<ElicitRequest["params"]> = {},
): ElicitRequest["params"] {
  return {
    message: "Choose an option",
    requestedSchema: {
      type: "object",
      properties: { choice: { type: "string" } },
      required: ["choice"],
    },
    ...extra,
  } as ElicitRequest["params"];
}

describe("appElicitation negotiation (#1854)", () => {
  describe("capability readers", () => {
    it("reads the UI block from either side", () => {
      expect(getUiClientCapability(eligibleClient())).toEqual({
        mimeTypes: [MCP_APP_MIME_TYPE],
        elicitation: {},
      });
      expect(getUiServerCapability(eligibleServer())).toEqual({
        elicitation: {},
      });
    });

    it("returns undefined for absent, null and non-object capabilities", () => {
      expect(getUiClientCapability(undefined)).toBeUndefined();
      expect(getUiClientCapability(null)).toBeUndefined();
      expect(getUiClientCapability({})).toBeUndefined();
      expect(getUiServerCapability({ extensions: {} })).toBeUndefined();
      expect(
        getUiClientCapability({
          extensions: { [UI_EXTENSION_KEY]: null },
        } as unknown as ClientCapabilities),
      ).toBeUndefined();
    });
  });

  describe("supportsAppElicitation", () => {
    it("is true only when all four gates pass", () => {
      expect(supportsAppElicitation(eligibleClient(), eligibleServer())).toBe(
        true,
      );
    });

    it("is false without the core form elicitation capability", () => {
      const client = eligibleClient();
      delete client.elicitation;
      expect(supportsAppElicitation(client, eligibleServer())).toBe(false);
    });

    it("is false when the client advertised only url-mode elicitation", () => {
      const client = { ...eligibleClient(), elicitation: { url: {} } };
      expect(supportsAppElicitation(client, eligibleServer())).toBe(false);
    });

    it("is false when the client does not accept the MCP App MIME type", () => {
      const client: ClientCapabilities = {
        elicitation: { form: {} },
        extensions: {
          [UI_EXTENSION_KEY]: { mimeTypes: ["text/html"], elicitation: {} },
        },
      };
      expect(supportsAppElicitation(client, eligibleServer())).toBe(false);
    });

    it("is false when the client advertises the MIME type but not elicitation", () => {
      // The specific "MIME type alone is not sufficient" case: this is exactly
      // what a CLI/TUI client looks like, and it must not be offered an app.
      const client: ClientCapabilities = {
        elicitation: { form: {} },
        extensions: {
          [UI_EXTENSION_KEY]: { mimeTypes: [MCP_APP_MIME_TYPE] },
        },
      };
      expect(supportsAppElicitation(client, eligibleServer())).toBe(false);
    });

    it("is false when the server did not advertise it", () => {
      expect(supportsAppElicitation(eligibleClient(), {})).toBe(false);
      expect(
        supportsAppElicitation(eligibleClient(), {
          extensions: { [UI_EXTENSION_KEY]: {} },
        }),
      ).toBe(false);
      expect(supportsAppElicitation(eligibleClient(), undefined)).toBe(false);
    });
  });

  describe("getElicitationUiResourceUri", () => {
    it("returns the URI from _meta.ui.resourceUri", () => {
      expect(
        getElicitationUiResourceUri(
          formParams({ _meta: { ui: { resourceUri: "ui://demo/pick.html" } } }),
        ),
      ).toBe("ui://demo/pick.html");
    });

    it("returns undefined when no app is attached", () => {
      expect(getElicitationUiResourceUri(formParams())).toBeUndefined();
      expect(
        getElicitationUiResourceUri(formParams({ _meta: {} })),
      ).toBeUndefined();
      expect(
        getElicitationUiResourceUri(formParams({ _meta: { ui: "nope" } })),
      ).toBeUndefined();
      expect(
        getElicitationUiResourceUri(formParams({ _meta: { ui: null } })),
      ).toBeUndefined();
      expect(
        getElicitationUiResourceUri(formParams({ _meta: { ui: {} } })),
      ).toBeUndefined();
    });

    it("throws on a non-string resourceUri", () => {
      expect(() =>
        getElicitationUiResourceUri(
          formParams({ _meta: { ui: { resourceUri: 42 } } }),
        ),
      ).toThrow(/must be a string/);
    });

    it.each([
      ["relative", "demo/pick.html"],
      ["wrong scheme", "https://example.com/pick.html"],
      ["scheme with no host", "ui:///pick.html"],
      ["bare scheme", "ui:pick.html"],
      ["not a URL at all", "  "],
    ])("throws on a %s URI", (_label, uri) => {
      expect(() =>
        getElicitationUiResourceUri(
          formParams({ _meta: { ui: { resourceUri: uri } } }),
        ),
      ).toThrow(/absolute ui:\/\/ URI/);
    });
  });

  describe("isFormElicitation", () => {
    it("treats an omitted mode as form", () => {
      expect(isFormElicitation(formParams())).toBe(true);
      expect(isFormElicitation(formParams({ mode: "form" }))).toBe(true);
    });

    it("rejects url mode", () => {
      expect(isFormElicitation(formParams({ mode: "url" }))).toBe(false);
    });
  });

  describe("validateAppElicitResult", () => {
    const provider = new AjvJsonSchemaValidator();
    const params = formParams();

    it("accepts a well-formed accept", () => {
      expect(
        validateAppElicitResult(provider, params, {
          action: "accept",
          content: { choice: "option-a" },
        }),
      ).toBeUndefined();
    });

    it("accepts decline and cancel with no content", () => {
      expect(
        validateAppElicitResult(provider, params, { action: "decline" }),
      ).toBeUndefined();
      expect(
        validateAppElicitResult(provider, params, { action: "cancel" }),
      ).toBeUndefined();
    });

    it("rejects a non-object result", () => {
      expect(
        validateAppElicitResult(
          provider,
          params,
          null as unknown as ElicitResult,
        ),
      ).toMatch(/non-object/);
    });

    it("rejects an unknown action", () => {
      expect(
        validateAppElicitResult(provider, params, {
          action: "maybe",
        } as unknown as ElicitResult),
      ).toMatch(/unknown elicitation action/);
    });

    it("rejects an accept with no usable content", () => {
      expect(
        validateAppElicitResult(provider, params, {
          action: "accept",
        } as ElicitResult),
      ).toMatch(/without a content object/);
      expect(
        validateAppElicitResult(provider, params, {
          action: "accept",
          content: [] as unknown as Record<string, never>,
        } as ElicitResult),
      ).toMatch(/without a content object/);
    });

    it("rejects content that does not match the requested schema", () => {
      expect(
        validateAppElicitResult(provider, params, {
          action: "accept",
          content: { choice: 7 } as unknown as Record<string, never>,
        } as ElicitResult),
      ).toMatch(/does not match the requested schema/);
    });

    it("skips validation when the request declared no usable schema", () => {
      const noSchema = { message: "hi" } as ElicitRequest["params"];
      expect(
        validateAppElicitResult(provider, noSchema, {
          action: "accept",
          content: { anything: true },
        }),
      ).toBeUndefined();
    });

    it("does not reject a result over a schema the validator cannot compile", () => {
      const badSchema = formParams({
        requestedSchema: { type: "object", properties: { a: { type: 9 } } },
      } as unknown as Partial<ElicitRequest["params"]>);
      expect(
        validateAppElicitResult(provider, badSchema, {
          action: "accept",
          content: { a: 1 },
        }),
      ).toBeUndefined();
    });
  });
});
