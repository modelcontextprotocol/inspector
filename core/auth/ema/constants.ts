/** RFC 8693 token exchange grant. */
export const GRANT_TYPE_TOKEN_EXCHANGE =
  "urn:ietf:params:oauth:grant-type:token-exchange";

/** RFC 7523 JWT bearer grant. */
export const GRANT_TYPE_JWT_BEARER =
  "urn:ietf:params:oauth:grant-type:jwt-bearer";

/** ID Token as subject_token (OIDC). */
export const TOKEN_TYPE_ID_TOKEN = "urn:ietf:params:oauth:token-type:id_token";

/** Identity Assertion JWT Authorization Grant (ID-JAG). */
export const TOKEN_TYPE_ID_JAG = "urn:ietf:params:oauth:token-type:id-jag";

/** OIDC scopes for IdP login (leg 1). */
export const IDP_OIDC_SCOPES = "openid offline_access";
