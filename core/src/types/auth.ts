/**
 * Authentication and OAuth types
 */

export interface OAuthState {
  authorizationUrl?: string;
  authorizationCode?: string;
  state?: string;
  stateVerified?: boolean;
  tokenEndpoint?: string;
  accessToken?: string;
  tokenType?: string;
  expiresIn?: number;
  expiresAt?: Date;
  refreshToken?: string;
  scopes?: string[];
  decodedToken?: {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
  };
}

/**
 * Root directory configuration for MCP roots capability
 */
export interface Root {
  name: string;
  uri: string;
}
