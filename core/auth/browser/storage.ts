import { createJSONStorage } from "zustand/middleware";
import { OAuthStorageBase } from "../oauth-storage.js";
import { createOAuthStore } from "../store.js";

/**
 * Browser storage implementation using Zustand with sessionStorage.
 * For web client (can be used by InspectorClient in browser).
 */
export class BrowserOAuthStorage extends OAuthStorageBase {
  constructor() {
    // Use Zustand's built-in sessionStorage adapter
    // The `name` option in persist() ("mcp-inspector-oauth") becomes the sessionStorage key
    super(createOAuthStore(createJSONStorage(() => sessionStorage)));
  }
}
