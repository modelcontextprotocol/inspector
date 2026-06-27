import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_RUNNER_OAUTH_CALLBACK_URL,
  RUNNER_OAUTH_CALLBACK_DEFAULT_PORT,
  formatRunnerOAuthRedirectUrl,
  parseRunnerOAuthCallbackUrl,
} from "@inspector/core/auth/node/runner-oauth-callback.js";

describe("runner OAuth callback URL", () => {
  const envKey = "MCP_OAUTH_CALLBACK_URL";

  afterEach(() => {
    delete process.env[envKey];
  });

  it("defaults to 127.0.0.1:6276", () => {
    expect(DEFAULT_RUNNER_OAUTH_CALLBACK_URL).toBe(
      "http://127.0.0.1:6276/oauth/callback",
    );
    expect(parseRunnerOAuthCallbackUrl()).toEqual({
      hostname: "127.0.0.1",
      port: RUNNER_OAUTH_CALLBACK_DEFAULT_PORT,
      pathname: "/oauth/callback",
    });
  });

  it("prefers CLI flag over env", () => {
    process.env[envKey] = "http://127.0.0.1:9999/oauth/callback";
    expect(
      parseRunnerOAuthCallbackUrl("http://127.0.0.1:3000/oauth/callback"),
    ).toEqual({
      hostname: "127.0.0.1",
      port: 3000,
      pathname: "/oauth/callback",
    });
  });

  it("uses MCP_OAUTH_CALLBACK_URL when CLI flag absent", () => {
    process.env[envKey] = "http://127.0.0.1:8888/custom/callback";
    expect(parseRunnerOAuthCallbackUrl()).toEqual({
      hostname: "127.0.0.1",
      port: 8888,
      pathname: "/custom/callback",
    });
  });

  it("allows port 0 for ephemeral listener", () => {
    expect(
      parseRunnerOAuthCallbackUrl("http://127.0.0.1:0/oauth/callback"),
    ).toEqual({
      hostname: "127.0.0.1",
      port: 0,
      pathname: "/oauth/callback",
    });
  });

  it("formatRunnerOAuthRedirectUrl round-trips default config", () => {
    const config = parseRunnerOAuthCallbackUrl();
    expect(formatRunnerOAuthRedirectUrl(config)).toBe(
      DEFAULT_RUNNER_OAUTH_CALLBACK_URL,
    );
  });
});
