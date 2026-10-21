/**
 * Per-flow PKCE verifier store (#2726).
 *
 * The web client's OAuth state lives in the backend's shared `oauth.json`,
 * merged at whole `servers[url]` granularity, and keyed by server URL only. Two
 * authorization flows for the same server that overlap in time — two tabs, or
 * two people on one deployed Inspector — therefore share one `codeVerifier`
 * slot: the later flow overwrites the earlier one's verifier, and the earlier
 * flow's token exchange fails PKCE with `invalid_grant`.
 *
 * A verifier is in-flight state that belongs to exactly one flow, so this store
 * keys it by the auth session id `generateOAuthState()` puts in the OAuth
 * `state` parameter (the 64-hex `authId`), and the callback looks it up by the
 * `state` it was redirected back with. Only the outcome of a completed flow
 * (client information, tokens) goes to the shared store.
 *
 * Keying inside the shared `servers[url]` entry instead would not help: the
 * remote backend merges whole server entries, so a second tab's write would
 * still replace the first tab's map. The web client therefore backs this with
 * the initiating tab's `sessionStorage`, which survives the full-page redirect
 * to the authorization server and back and is never visible to another tab.
 */

/** In-flight PKCE verifiers, keyed by the OAuth `state` authId of their flow. */
export interface PkceFlowStore {
  saveCodeVerifier(
    flowId: string,
    serverUrl: string,
    codeVerifier: string,
  ): Promise<void>;
  /**
   * The verifier saved for `flowId`, or `undefined` when there is none — or
   * when the flow was started for a different server, so a `state` replayed
   * against another server can never borrow that server's verifier.
   */
  getCodeVerifier(
    flowId: string,
    serverUrl: string,
  ): Promise<string | undefined>;
  clearCodeVerifier(flowId: string): Promise<void>;
}

/** The subset of the Web Storage API the store uses. */
export type PkceFlowStorageArea = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export const PKCE_FLOW_STORAGE_KEY_PREFIX = "mcp-inspector:pkce-flow:";

interface StoredPkceFlow {
  serverUrl: string;
  codeVerifier: string;
}

function parseStoredFlow(raw: string | null): StoredPkceFlow | undefined {
  if (raw === null) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "serverUrl" in value &&
      "codeVerifier" in value &&
      typeof value.serverUrl === "string" &&
      typeof value.codeVerifier === "string"
    ) {
      return { serverUrl: value.serverUrl, codeVerifier: value.codeVerifier };
    }
  } catch {
    // A corrupt entry is treated as absent: the callback then fails with the
    // "no verifier for this flow" error rather than throwing a parse error.
  }
  return undefined;
}

/**
 * A {@link PkceFlowStore} over a Web Storage area — `sessionStorage` by
 * default, so each verifier is scoped to the tab that started its flow.
 */
export function createWebStoragePkceFlowStore(
  getStorage: () => PkceFlowStorageArea = () => sessionStorage,
): PkceFlowStore {
  const key = (flowId: string) => `${PKCE_FLOW_STORAGE_KEY_PREFIX}${flowId}`;
  return {
    async saveCodeVerifier(flowId, serverUrl, codeVerifier) {
      const entry: StoredPkceFlow = { serverUrl, codeVerifier };
      getStorage().setItem(key(flowId), JSON.stringify(entry));
    },
    async getCodeVerifier(flowId, serverUrl) {
      const entry = parseStoredFlow(getStorage().getItem(key(flowId)));
      return entry?.serverUrl === serverUrl ? entry.codeVerifier : undefined;
    },
    async clearCodeVerifier(flowId) {
      getStorage().removeItem(key(flowId));
    },
  };
}
