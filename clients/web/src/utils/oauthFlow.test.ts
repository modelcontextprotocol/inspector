import { describe, it, expect } from "vitest";
import {
  SdkError,
  SdkErrorCode,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import {
  OAUTH_CALLBACK_PATH,
  OAUTH_PENDING_SERVER_KEY,
  isUnauthorizedError,
} from "./oauthFlow";

describe("oauthFlow constants", () => {
  it("uses the redirect path the providers expect", () => {
    expect(OAUTH_CALLBACK_PATH).toBe("/oauth/callback");
  });

  it("namespaces the pending-server key", () => {
    expect(OAUTH_PENDING_SERVER_KEY).toBe(
      "mcp-inspector:oauth-pending-server-id",
    );
  });
});

describe("isUnauthorizedError", () => {
  it("detects a 401 carried on error.status", () => {
    const err = Object.assign(new Error("Remote send failed"), { status: 401 });
    expect(isUnauthorizedError(err)).toBe(true);
  });

  it("detects a 401 carried on error.code", () => {
    const err = Object.assign(new Error("boom"), { code: 401 });
    expect(isUnauthorizedError(err)).toBe(true);
  });

  it("detects a 401 formatted into the message when status is lost", () => {
    const err = new Error(
      'Remote send failed (401): {"error":"invalid_token","error_description":"Missing Authorization header"}',
    );
    expect(isUnauthorizedError(err)).toBe(true);
  });

  it("matches a 401 in a plain (non-Error) thrown value", () => {
    expect(isUnauthorizedError("Remote connect failed (401): nope")).toBe(true);
  });

  it("does not treat other status codes as unauthorized", () => {
    const err = Object.assign(new Error("Remote send failed (500): boom"), {
      status: 500,
    });
    expect(isUnauthorizedError(err)).toBe(false);
  });

  it("does not match a bare 401 substring that isn't the formatted status", () => {
    // The transport formats the status as "(401)"; a 401 appearing elsewhere
    // (e.g. inside an id or token) must not be mistaken for an auth failure.
    const err = new Error("tool returned value 40123 for request");
    expect(isUnauthorizedError(err)).toBe(false);
  });

  it("does not match a stray '(401)' that isn't the transport's 'failed' wording", () => {
    // A tool result or unrelated message embedding `(401)` without the
    // transport's `failed …(401)` shape must not trip the OAuth flow.
    const err = new Error("tool output: response code (401) seen upstream");
    expect(isUnauthorizedError(err)).toBe(false);
  });

  it("returns false for null / undefined / non-401 primitives", () => {
    expect(isUnauthorizedError(null)).toBe(false);
    expect(isUnauthorizedError(undefined)).toBe(false);
    expect(isUnauthorizedError(42)).toBe(false);
  });

  it("unwraps EraNegotiationFailed → UnauthorizedError (data.cause)", () => {
    expect(
      isUnauthorizedError(
        new SdkError(SdkErrorCode.EraNegotiationFailed, "probe failed", {
          cause: new UnauthorizedError("Unauthorized"),
        }),
      ),
    ).toBe(true);
  });
});
