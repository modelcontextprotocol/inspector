import { describe, it, expect } from "vitest";
import type { ServerCapabilities } from "@modelcontextprotocol/client";
import {
  getEventsExtension,
  isEventsSupported,
} from "@inspector/core/extension/events/support.js";
import { EVENTS_EXTENSION_KEY } from "@inspector/core/extension/events/constants.js";

function caps(settings: unknown): ServerCapabilities {
  // `extensions` values are typed as objects; a malformed server can still
  // send anything, which is what the non-object cases below model.
  return {
    extensions: { [EVENTS_EXTENSION_KEY]: settings },
  } as ServerCapabilities;
}

describe("isEventsSupported / getEventsExtension (#3028)", () => {
  it("requires a modern era", () => {
    expect(isEventsSupported(caps({}), "legacy")).toBe(false);
    expect(isEventsSupported(caps({}), undefined)).toBe(false);
    expect(isEventsSupported(caps({}), "modern")).toBe(true);
  });

  it("requires the server's advertisement", () => {
    expect(isEventsSupported(undefined, "modern")).toBe(false);
    expect(isEventsSupported({}, "modern")).toBe(false);
    expect(isEventsSupported({ extensions: {} }, "modern")).toBe(false);
  });

  it("rejects a non-object settings value", () => {
    expect(isEventsSupported(caps(true), "modern")).toBe(false);
    expect(isEventsSupported(caps(null), "modern")).toBe(false);
    expect(isEventsSupported(caps([]), "modern")).toBe(false);
  });

  it("reads listChanged, defaulting to false", () => {
    expect(getEventsExtension(caps({}), "modern")).toEqual({
      listChanged: false,
    });
    expect(getEventsExtension(caps({ listChanged: true }), "modern")).toEqual({
      listChanged: true,
    });
    expect(getEventsExtension(caps({ listChanged: "yes" }), "modern")).toEqual({
      listChanged: false,
    });
  });
});
