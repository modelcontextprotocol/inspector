/**
 * Remote transport client - pure TypeScript, runs in browser, Deno, or Node.
 * Talks to the remote server for MCP connections when direct transport is not available.
 */

export {
  RemoteClientTransport,
  type RemoteTransportOptions,
} from "./remoteClientTransport.js";
export {
  createRemoteTransport,
  type RemoteTransportFactoryOptions,
} from "./createRemoteTransport.js";
export {
  createRemoteFetch,
  type RemoteFetchOptions,
} from "./createRemoteFetch.js";
export {
  createRemoteLogger,
  type RemoteLoggerOptions,
} from "./createRemoteLogger.js";
export {
  RemoteInspectorClientStorage,
  type RemoteInspectorClientStorageOptions,
} from "./sessionStorage.js";
export type {
  RemoteConnectRequest,
  RemoteConnectResponse,
  RemoteEvent,
} from "./types.js";
export { API_SERVER_ENV_VARS, LEGACY_AUTH_TOKEN_ENV } from "./constants.js";
