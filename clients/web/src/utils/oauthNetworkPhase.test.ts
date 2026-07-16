import { describe, it, expect } from "vitest";
import { oauthNetworkPhase, oauthNetworkPhaseLabel } from "./oauthNetworkPhase";

describe("oauthNetworkPhase", () => {
  it("classifies RFC 9728/8414 discovery requests", () => {
    expect(
      oauthNetworkPhase(
        "https://mcp.example.com/.well-known/oauth-protected-resource",
      ),
    ).toBe("discovery");
    expect(
      oauthNetworkPhase(
        "https://as.example.com/.well-known/oauth-authorization-server",
      ),
    ).toBe("discovery");
    expect(
      oauthNetworkPhase(
        "https://as.example.com/.well-known/openid-configuration",
      ),
    ).toBe("discovery");
  });

  it("classifies registration, token, and authorize endpoints", () => {
    expect(oauthNetworkPhase("https://as.example.com/register")).toBe(
      "registration",
    );
    expect(oauthNetworkPhase("https://as.example.com/oauth/token")).toBe(
      "token",
    );
    expect(
      oauthNetworkPhase("https://as.example.com/authorize?state=abc"),
    ).toBe("authorize");
  });

  it("matches on the path, ignoring misleading query params", () => {
    // A `/token` substring in the query must not classify an authorize request.
    expect(
      oauthNetworkPhase(
        "https://as.example.com/authorize?redirect_uri=https://app/token",
      ),
    ).toBe("authorize");
  });

  it("returns undefined for unrelated URLs", () => {
    expect(oauthNetworkPhase("https://mcp.example.com/mcp")).toBeUndefined();
  });

  it("matches the endpoint as the final path segment, not a nested one", () => {
    // A nested segment must not classify as the OAuth endpoint...
    expect(
      oauthNetworkPhase("https://as.example.com/oauth/token/refresh"),
    ).toBeUndefined();
    expect(
      oauthNetworkPhase("https://gw.example.com/api/register/foo"),
    ).toBeUndefined();
    // ...but a trailing slash on the real endpoint is tolerated.
    expect(oauthNetworkPhase("https://as.example.com/oauth/token/")).toBe(
      "token",
    );
  });

  it("tolerates a non-absolute URL by stripping the query", () => {
    expect(oauthNetworkPhase("/register?foo=bar")).toBe("registration");
    expect(oauthNetworkPhase("not a url")).toBeUndefined();
  });

  it("maps phases to human-readable labels", () => {
    expect(oauthNetworkPhaseLabel("discovery")).toBe("Discovery");
    expect(oauthNetworkPhaseLabel("registration")).toBe("Registration");
    expect(oauthNetworkPhaseLabel("authorize")).toBe("Authorize");
    expect(oauthNetworkPhaseLabel("token")).toBe("Token");
  });
});
