/**
 * OpenID Connect (OIDC) support handlers
 */
import { UserInfoRequest, ValidateIdTokenRequest } from "./types.js";

/**
 * Fetch user information from UserInfo endpoint
 */
export async function fetchUserInfo(
  request: UserInfoRequest,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(request.userInfoEndpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${request.accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `UserInfo request failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const userInfo = (await response.json()) as Record<string, unknown>;
    return userInfo;
  } catch (error) {
    console.error("Error fetching UserInfo:", error);
    throw error;
  }
}

/**
 * Validate ID token (INCOMPLETE - signature verification not implemented)
 *
 * ⚠️ SECURITY WARNING ⚠️
 * This function does NOT verify the JWT signature and should NOT be used in production.
 * It only performs basic claims validation (issuer, audience, expiration).
 *
 * For production use, you MUST use a proper JWT library that verifies signatures:
 * - jose (https://github.com/panva/jose) - recommended
 * - jsonwebtoken (https://github.com/auth0/node-jsonwebtoken)
 *
 * @deprecated This function is incomplete and insecure. Use a proper JWT library.
 */
export async function validateIdToken(
  request: ValidateIdTokenRequest,
): Promise<{
  valid: boolean;
  payload?: Record<string, unknown>;
  error?: string;
  warning?: string;
}> {
  try {
    // Split the JWT into parts
    const parts = request.idToken.split(".");
    if (parts.length !== 3) {
      return { valid: false, error: "Invalid JWT format" };
    }

    // Decode the payload (middle part) - NO SIGNATURE VERIFICATION
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    ) as Record<string, unknown>;

    // Basic validation checks (claims only)
    if (payload.iss !== request.issuer) {
      return { valid: false, error: "Invalid issuer" };
    }

    if (payload.aud !== request.clientId) {
      return { valid: false, error: "Invalid audience" };
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && payload.exp < now) {
      return { valid: false, error: "Token expired" };
    }

    // Return with warning about missing signature verification
    return {
      valid: true,
      payload,
      warning:
        "SECURITY WARNING: Token signature was NOT verified. This validation is incomplete and should not be trusted for security-critical operations.",
    };
  } catch (error) {
    console.error("Error validating ID token:", error);
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
