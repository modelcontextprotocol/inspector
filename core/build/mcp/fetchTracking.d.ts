import type { FetchRequestEntryBase } from "./types.js";
export interface FetchTrackingCallbacks {
    trackRequest?: (entry: FetchRequestEntryBase) => void;
}
/**
 * Creates a fetch wrapper that tracks HTTP requests and responses
 */
export declare function createFetchTracker(baseFetch: typeof fetch, callbacks: FetchTrackingCallbacks): typeof fetch;
//# sourceMappingURL=fetchTracking.d.ts.map