/**
 * Barrel for the MCP config import layer (#1348). Re-exports the strategy
 * registry, the client-config + registry-server.json parsers, and the
 * strategy-agnostic merge helpers. Pure + isomorphic — safe to import from the
 * browser and from the Node backend route alike.
 */
export type { ImportStrategy, ImportSourceResult } from "./types.js";
export { parseMcpServersConfig, parseVsCodeConfig } from "./clientConfig.js";
export {
  parseServerJson,
  buildServerConfig,
  deriveServerId,
} from "./serverJson.js";
export type {
  ParsedServerJson,
  ServerJsonOption,
  ServerJsonEnvVar,
} from "./serverJson.js";
export {
  IMPORT_STRATEGIES,
  IMPORT_STRATEGY_LIST,
  getImportStrategy,
} from "./strategies.js";
export { resolveImportSource } from "./resolveSource.js";
export type { ImportFileReader } from "./resolveSource.js";
export { planImport, uniqueId } from "./merge.js";
export type {
  ImportPlan,
  ImportAddition,
  ImportConflict,
  ConflictResolution,
} from "./merge.js";
