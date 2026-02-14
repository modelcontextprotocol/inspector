import type { OAuthMetadata, OAuthClientInformation, OAuthClientInformationFull, OAuthTokens, OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
export type OAuthStep = "metadata_discovery" | "client_registration" | "authorization_redirect" | "authorization_code" | "token_request" | "complete";
export type MessageType = "success" | "error" | "info";
export interface StatusMessage {
    type: MessageType;
    message: string;
}
export type OAuthAuthType = "guided" | "normal";
export interface AuthGuidedState {
    /** How this auth flow was started; determines which fields are populated. */
    authType: OAuthAuthType;
    /** When auth reached step "complete" (ms since epoch), if applicable. */
    completedAt: number | null;
    isInitiatingAuth: boolean;
    oauthTokens: OAuthTokens | null;
    oauthStep: OAuthStep;
    resourceMetadata: OAuthProtectedResourceMetadata | null;
    resourceMetadataError: Error | null;
    resource: URL | null;
    authServerUrl: URL | null;
    oauthMetadata: OAuthMetadata | null;
    oauthClientInfo: OAuthClientInformationFull | OAuthClientInformation | null;
    authorizationUrl: URL | null;
    authorizationCode: string;
    latestError: Error | null;
    statusMessage: StatusMessage | null;
    validationError: string | null;
}
export declare const EMPTY_GUIDED_STATE: AuthGuidedState;
export type CallbackParams = {
    successful: true;
    code: string;
} | {
    successful: false;
    error: string;
    error_description: string | null;
    error_uri: string | null;
};
//# sourceMappingURL=types.d.ts.map