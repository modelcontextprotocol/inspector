import { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

export function isTokenExpired(tokens: OAuthTokens & { issued_at?: number }) {
  if (!tokens.access_token) {
    throw new Error("No access_token provided");
  }
  const jwtParts = tokens.access_token.split(".");
  if (jwtParts.length !== 3) {
    throw new Error("Invalid JWT format");
  }
  try {
    const payload = JSON.parse(
      atob(jwtParts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    const exp = Number(payload.exp);
    if (isNaN(exp)) {
      throw new Error("exp field in JWT payload is not a number");
    }
    return Date.now() / 1000 >= exp;
  } catch (err) {
    throw new Error(`Failed to parse JWT: ${(err as Error).message}`);
  }
}
