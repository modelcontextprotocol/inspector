import { describe, expect, it } from "@jest/globals";
import { extractResourceMetadataUrlFromError } from "../extractResourceMetadataUrl";

const META_URL =
  "https://example.com/runtimes/abc/.well-known/oauth-protected-resource?qualifier=DEFAULT";

describe("extractResourceMetadataUrlFromError", () => {
  it("returns undefined for non-objects, plain Errors, empty objects", () => {
    expect(
      extractResourceMetadataUrlFromError(new Error("boom")),
    ).toBeUndefined();
    expect(extractResourceMetadataUrlFromError(undefined)).toBeUndefined();
    expect(extractResourceMetadataUrlFromError(null)).toBeUndefined();
    expect(extractResourceMetadataUrlFromError({})).toBeUndefined();
    expect(extractResourceMetadataUrlFromError("string error")).toBeUndefined();
  });

  it("extracts from .resourceMetadataUrl as URL", () => {
    expect(
      extractResourceMetadataUrlFromError({
        resourceMetadataUrl: new URL(META_URL),
      })?.toString(),
    ).toBe(META_URL);
  });

  it("extracts from .resourceMetadataUrl as string", () => {
    expect(
      extractResourceMetadataUrlFromError({
        resourceMetadataUrl: META_URL,
      })?.toString(),
    ).toBe(META_URL);
  });

  it("ignores .resourceMetadataUrl when not parseable, falls through", () => {
    expect(
      extractResourceMetadataUrlFromError({
        resourceMetadataUrl: "not a url",
        data: {
          upstream401: {
            wwwAuthenticate: `Bearer resource_metadata="${META_URL}"`,
          },
        },
      })?.toString(),
    ).toBe(META_URL);
  });

  it("extracts from .response.headers (quoted resource_metadata)", () => {
    const err = {
      response: {
        headers: new Headers({
          "www-authenticate": `Bearer realm="mcp", resource_metadata="${META_URL}"`,
        }),
      },
    };
    expect(extractResourceMetadataUrlFromError(err)?.toString()).toBe(META_URL);
  });

  it("extracts from .headers (unquoted resource_metadata)", () => {
    const err = {
      headers: new Headers({
        "www-authenticate": `Bearer resource_metadata=${META_URL}`,
      }),
    };
    expect(extractResourceMetadataUrlFromError(err)?.toString()).toBe(META_URL);
  });

  it("extracts from data.upstream401.wwwAuthenticate (proxy-mode)", () => {
    const err = {
      code: -32099,
      data: {
        httpStatus: 401,
        upstream401: {
          wwwAuthenticate: `Bearer realm="mcp", resource_metadata="${META_URL}"`,
          body: '{"error":"Missing Authentication Token"}',
          contentType: "application/json",
        },
      },
    };
    expect(extractResourceMetadataUrlFromError(err)?.toString()).toBe(META_URL);
  });

  it("returns undefined for upstream401 without WWW-Authenticate", () => {
    expect(
      extractResourceMetadataUrlFromError({
        data: { upstream401: { body: "x" } },
      }),
    ).toBeUndefined();
  });

  it("returns undefined when resource_metadata is not a valid URL", () => {
    expect(
      extractResourceMetadataUrlFromError({
        data: {
          upstream401: {
            wwwAuthenticate: 'Bearer resource_metadata="bad url"',
          },
        },
      }),
    ).toBeUndefined();
  });

  it("priority: .resourceMetadataUrl beats both header and envelope", () => {
    const winner = "https://winner.example.com/.well-known/x";
    const err = {
      resourceMetadataUrl: winner,
      response: {
        headers: new Headers({
          "www-authenticate": `Bearer resource_metadata="${META_URL}"`,
        }),
      },
      data: {
        upstream401: {
          wwwAuthenticate: `Bearer resource_metadata="https://other"`,
        },
      },
    };
    expect(extractResourceMetadataUrlFromError(err)?.toString()).toBe(winner);
  });
});
