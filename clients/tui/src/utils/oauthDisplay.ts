import type {
  OAuthClientRegistrationKind,
  OAuthConnectionState,
} from "@inspector/core/auth/types.js";

export function formatAuthProtocol(
  protocol: OAuthConnectionState["protocol"],
): string {
  return protocol === "ema" ? "Enterprise-managed" : "Standard";
}

export function formatIdpSession(
  session: NonNullable<OAuthConnectionState["ema"]>["idpSession"],
): string {
  switch (session) {
    case "logged_in":
      return "Signed in";
    case "expired":
      return "Session expired";
    default:
      return "Not signed in";
  }
}

export function formatClientRegistrationKind(
  kind: OAuthClientRegistrationKind,
): string {
  switch (kind) {
    case "static":
      return "Static (preregistered)";
    case "dcr":
      return "Dynamic (DCR)";
    case "cimd":
      return "Client ID Metadata (CIMD)";
  }
}

export function formatScopes(state: OAuthConnectionState): string | undefined {
  const scopeSource = state.grantedScope ?? state.configuredScope;
  const scopes = scopeSource?.split(" ").filter(Boolean);
  return scopes && scopes.length > 0 ? scopes.join(", ") : undefined;
}
