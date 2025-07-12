import { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

export function isTokenExpired(tokens: OAuthTokens & { issued_at?: number }) {
  try {
    if (!tokens.access_token) {
      console.warn("No access_token provided");
      return true;
    }
    const jwtParts = tokens.access_token.split(".");
    if (jwtParts.length !== 3) {
      console.warn("Invalid JWT format");
      return true;
    }
    const payload = JSON.parse(
      atob(jwtParts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    const exp = Number(payload.exp);
    if (isNaN(exp)) {
      console.warn("exp field in JWT payload is not a number");
      return true;
    }
    return Date.now() / 1000 >= exp;
  } catch (err) {
    console.warn(
      `Failed to verify token expiration: ${(err as Error).message}`,
    );
    return true;
  }
}
