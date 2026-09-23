export {
  assertDaemonToken,
  generateDaemonToken,
  getDaemonTokenFromEnv,
  readDaemonTokenFile,
  tokensEqual,
} from "./auth.js";
export { callDaemon } from "./client.js";
export { streamDaemon } from "./stream-client.js";
export { ensureDaemon, resolveDaemonScriptPath } from "./ensure.js";
export { encodeRequest, encodeResponse, parseRequestLine } from "./framing.js";
export {
  assertSocketPathWithinLimit,
  createPrivateDaemonDir,
  DAEMON_DIR_ENV,
  DAEMON_TOKEN_ENV,
  ensureDaemonDir,
  getDaemonDir,
  getDaemonLockPath,
  getDaemonLogPath,
  getDaemonSocketPath,
  getDaemonTokenPath,
} from "./paths.js";
export type {
  ConnectParams,
  DaemonOp,
  DaemonRequest,
  DaemonResponse,
  DaemonStatus,
  RpcParams,
  RpcResult,
  SessionInfo,
  SessionNameParams,
} from "./protocol.js";
export { DaemonServer } from "./server.js";
export {
  DEFAULT_IDLE_MS,
  isSessionAuthRequiredError,
  SessionRegistry,
} from "./sessions.js";
