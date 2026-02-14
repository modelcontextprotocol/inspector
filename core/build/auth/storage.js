/**
 * Generate server-specific storage key
 */
export function getServerSpecificKey(baseKey, serverUrl) {
    return `[${serverUrl}] ${baseKey}`;
}
/**
 * Base storage keys for OAuth data
 */
export const OAUTH_STORAGE_KEYS = {
    CODE_VERIFIER: "mcp_code_verifier",
    TOKENS: "mcp_tokens",
    CLIENT_INFORMATION: "mcp_client_information",
    PREREGISTERED_CLIENT_INFORMATION: "mcp_preregistered_client_information",
    SERVER_METADATA: "mcp_server_metadata",
    SCOPE: "mcp_scope",
};
//# sourceMappingURL=storage.js.map