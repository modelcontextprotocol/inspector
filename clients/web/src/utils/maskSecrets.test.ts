import { describe, it, expect } from "vitest";
import { maskSecretsInBody, MASK_PLACEHOLDER } from "./maskSecrets";

describe("maskSecretsInBody", () => {
  it("masks token fields in a token-exchange response and flags secrets", () => {
    const body = JSON.stringify({
      access_token: "abc.def.ghi",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "r3fr3sh",
      scope: "mcp:tools",
    });
    const { masked, hasSecrets } = maskSecretsInBody(body);
    expect(hasSecrets).toBe(true);
    const parsed = JSON.parse(masked);
    expect(parsed.access_token).toBe(MASK_PLACEHOLDER);
    expect(parsed.refresh_token).toBe(MASK_PLACEHOLDER);
    // Non-secret fields pass through untouched.
    expect(parsed.token_type).toBe("Bearer");
    expect(parsed.expires_in).toBe(3600);
    expect(parsed.scope).toBe("mcp:tools");
    // The raw secret never appears in the masked output.
    expect(masked).not.toContain("abc.def.ghi");
    expect(masked).not.toContain("r3fr3sh");
  });

  it("masks id_token and client_secret (case-insensitive keys)", () => {
    const body = JSON.stringify({
      ID_Token: "jwt",
      Client_Secret: "shhh",
      client_id: "public-123",
    });
    const { masked, hasSecrets } = maskSecretsInBody(body);
    expect(hasSecrets).toBe(true);
    const parsed = JSON.parse(masked);
    expect(parsed.ID_Token).toBe(MASK_PLACEHOLDER);
    expect(parsed.Client_Secret).toBe(MASK_PLACEHOLDER);
    // client_id is not a secret.
    expect(parsed.client_id).toBe("public-123");
  });

  it("masks secrets nested in objects and arrays", () => {
    const body = JSON.stringify({
      data: { tokens: [{ access_token: "deep" }] },
    });
    const { masked, hasSecrets } = maskSecretsInBody(body);
    expect(hasSecrets).toBe(true);
    expect(JSON.parse(masked).data.tokens[0].access_token).toBe(
      MASK_PLACEHOLDER,
    );
  });

  it("reports no secrets (and leaves content intact) for discovery metadata", () => {
    const body = JSON.stringify({
      issuer: "http://localhost:3001/",
      authorization_endpoint: "http://localhost:3001/authorize",
      scopes_supported: ["mcp:tools"],
    });
    const { masked, hasSecrets } = maskSecretsInBody(body);
    expect(hasSecrets).toBe(false);
    expect(JSON.parse(masked).authorization_endpoint).toBe(
      "http://localhost:3001/authorize",
    );
  });

  it("does not flag an empty-string secret value", () => {
    const { hasSecrets } = maskSecretsInBody(
      JSON.stringify({ access_token: "" }),
    );
    expect(hasSecrets).toBe(false);
  });

  it("returns a form body with no sensitive params unchanged", () => {
    const body = "grant_type=authorization_code&redirect_uri=http://x/cb";
    const { masked, hasSecrets } = maskSecretsInBody(body);
    expect(hasSecrets).toBe(false);
    expect(masked).toBe(body);
  });

  it("masks sensitive params in a form-encoded token request, preserving other params", () => {
    const body =
      "grant_type=authorization_code&code=AUTHCODE&code_verifier=VERIFIER&client_id=public-1&redirect_uri=http://x/cb";
    const { masked, hasSecrets } = maskSecretsInBody(body);
    expect(hasSecrets).toBe(true);
    expect(masked).toContain(`code=${MASK_PLACEHOLDER}`);
    expect(masked).toContain(`code_verifier=${MASK_PLACEHOLDER}`);
    expect(masked).not.toContain("AUTHCODE");
    expect(masked).not.toContain("VERIFIER");
    // Non-secret params are untouched (and formatting preserved).
    expect(masked).toContain("grant_type=authorization_code");
    expect(masked).toContain("client_id=public-1");
    expect(masked).toContain("redirect_uri=http://x/cb");
  });

  it("masks refresh_token and client_secret in a form-encoded refresh request", () => {
    const body =
      "grant_type=refresh_token&refresh_token=RTVAL&client_secret=CSVAL";
    const { masked, hasSecrets } = maskSecretsInBody(body);
    expect(hasSecrets).toBe(true);
    expect(masked).not.toContain("RTVAL");
    expect(masked).not.toContain("CSVAL");
  });

  it("does NOT mask a JSON `code` field (e.g. a JSON-RPC error code)", () => {
    // `code` is form-only sensitive; in JSON it's usually an error/status code.
    const { masked, hasSecrets } = maskSecretsInBody(
      JSON.stringify({ code: "some-string-code", message: "boom" }),
    );
    expect(hasSecrets).toBe(false);
    expect(JSON.parse(masked).code).toBe("some-string-code");
  });

  it("does not treat pure reformatting as masking", () => {
    // Minified JSON with no secret keys → reserialized but hasSecrets false.
    const { hasSecrets } = maskSecretsInBody('{"a":1,"b":[2,3]}');
    expect(hasSecrets).toBe(false);
  });

  it("passes through valid-but-non-object JSON (string / number / null) untouched", () => {
    for (const raw of ['"abc"', "42", "null", "true"]) {
      const { masked, hasSecrets } = maskSecretsInBody(raw);
      expect(hasSecrets).toBe(false);
      expect(JSON.parse(masked)).toEqual(JSON.parse(raw));
    }
  });
});
